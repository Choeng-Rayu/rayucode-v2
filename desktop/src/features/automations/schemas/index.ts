import { z } from "zod"

export const overnightRunStatusSchema = z.enum([
  "Running",
  "Paused",
  "Completed",
  "Cancelled",
])

export const automationPermissionModeSchema = z.enum([
  "Plan",
  "Auto-edit",
  "Full Manage",
])

export const overnightRunSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: overnightRunStatusSchema,
  host: z.string().min(1),
  repo: z.string().min(1).optional(),
  maxAgents: z.string().min(1),
  duration: z.string().min(1),
  wakeTime: z.string().min(1),
  handoffTime: z.string().min(1),
  taskCardsCount: z.number().int().nonnegative(),
  validationsGreen: z.number().int().nonnegative(),
  eventLog: z.array(z.string()),
})

export const automationScheduleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  modeBadge: automationPermissionModeSchema,
  cronSummary: z.string().min(1),
  repo: z.string().min(1),
  description: z.string().min(1),
  enabled: z.boolean(),
})

export const morningHandoffReportSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.literal("Completed"),
  timestamp: z.string().min(1),
  testsSummary: z.string().min(1),
  credits: z.string().min(1),
  kvWarmPct: z.number().min(0).max(100),
  actionLabel: z.string().min(1),
  targetRoute: z.enum(["changes", "workspace"]),
})

export const automationsStateSchema = z.object({
  running: z.array(overnightRunSchema),
  schedules: z.array(automationScheduleSchema),
  reports: z.array(morningHandoffReportSchema),
})

export const OVERNIGHT_REPO_OPTIONS = [
  "rayucode-v2",
  "rayu-web",
  "specs-and-docs",
] as const

export const OVERNIGHT_DURATION_OPTIONS = [
  { value: "2h", label: "2h focused" },
  { value: "4h", label: "4h evening" },
  { value: "8h", label: "8h overnight" },
] as const

export const OVERNIGHT_AGENT_CAP_OPTIONS = [
  { value: "2 agents", label: "max 2 agents" },
  { value: "4 agents", label: "max 4 agents" },
  { value: "6 agents", label: "max 6 agents" },
] as const

export const OVERNIGHT_PERMISSION_OPTIONS = [
  { value: "Auto-edit", label: "Auto-edit" },
  { value: "Plan (read-only)", label: "Plan (read-only)" },
  { value: "Full Manage", label: "Full Manage" },
] as const

export const OVERNIGHT_HANDOFF_TIME_OPTIONS = [
  "06:45 AM",
  "07:00 AM",
  "07:30 AM",
  "08:00 AM",
] as const

export const launchOvernightInputSchema = z.object({
  mission: z
    .string()
    .trim()
    .min(3, "Describe the overnight mission (at least 3 characters)"),
  repo: z.string().trim().min(1, "Select a target repository"),
  duration: z.enum([
    "2h",
    "4h",
    "8h",
    "2h focused",
    "4h evening",
    "8h overnight",
  ]),
  maxAgents: z.enum([
    "2 agents",
    "4 agents",
    "6 agents",
    "max 2 agents",
    "max 4 agents",
    "max 6 agents",
  ]),
  permissionMode: z.enum(["Auto-edit", "Plan (read-only)", "Full Manage"]),
  handoffTime: z.string().trim().min(1, "Specify a morning handoff time"),
})

export type ValidatedLaunchOvernightInput = z.infer<
  typeof launchOvernightInputSchema
>
