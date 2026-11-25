import { z } from "zod"

import type { TelegramCommandItem } from "../types"

export const BOT_TOKEN_PATTERN = /^\d{6,12}:[A-Za-z0-9_-]{20,}$/
export const CHAT_ID_PATTERN = /^\d{5,20}$/

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
  pairingCommand: z.string(),
  pairingLink: z.string(),
  remoteUninstallEnabled: z.boolean(),
  approvals: z.array(telegramApprovalItemSchema),
  commands: z.array(telegramCommandItemSchema),
  linked: z.boolean().optional(),
  configured: z.boolean().optional(),
  statusLabel: z.string().optional(),
  bridgeMode: z.enum(["hosted", "botfather"]).nullable().optional(),
  daemonConnected: z.boolean().optional(),
  qrSize: z.number().int().positive().nullable().optional(),
  qrPath: z.string().nullable().optional(),
  pendingUntil: z.number().nullable().optional(),
  daemonError: z.string().nullable().optional(),
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
    .optional()
    .default("")
    .refine(
      (val) => val.length === 0 || CHAT_ID_PATTERN.test(val),
      "Allowed chat ID must be a positive numeric Telegram ID (e.g. 842910443)"
    ),
  replaceExisting: z.boolean().optional(),
})

export type ValidatedConnectBotTokenInput = z.infer<
  typeof connectBotTokenInputSchema
>

export const SUPPLEMENTAL_TELEGRAM_COMMANDS: readonly TelegramCommandItem[] = [
  {
    command: "/sessions",
    description: "Pick which local RayuCode session to drive",
  },
  {
    command: "/switch",
    description: "Switch directly to another local RayuCode session",
  },
  {
    command: "/status",
    description: "Inspect active session, model route, and turn state",
  },
  {
    command: "/model",
    description: "Choose a configured model for the selected session",
  },
  {
    command: "/provider",
    description: "Browse configured providers on this host",
  },
  {
    command: "/connect",
    description: "Show local host sign-in instructions for a provider",
  },
  {
    command: "/interrupt",
    description: "Cancel the currently running Telegram turn",
  },
  {
    command: "/answer",
    description: "Reply to a pending interactive question from the agent",
  },
  {
    command: "/stop",
    description: "Disconnect Telegram remote control from this host",
  },
  {
    command: "/uninstall",
    description: "Remove managed CLI (guarded by Safety toggle + code)",
  },
] as const
