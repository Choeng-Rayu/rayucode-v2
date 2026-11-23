export type OvernightRunStatus = "Running" | "Paused" | "Completed" | "Cancelled"

export type AutomationPermissionMode = "Plan" | "Auto-edit" | "Full Manage"

export type MorningReportTargetRoute = "changes" | "workspace"

export interface OvernightRun {
  id: string
  title: string
  status: OvernightRunStatus
  host: string
  repo?: string
  maxAgents: string
  duration: string
  wakeTime: string
  handoffTime: string
  taskCardsCount: number
  validationsGreen: number
  eventLog: string[]
}

export interface AutomationSchedule {
  id: string
  title: string
  modeBadge: AutomationPermissionMode
  cronSummary: string
  repo: string
  description: string
  enabled: boolean
}

export interface MorningHandoffReport {
  id: string
  title: string
  status: "Completed"
  timestamp: string
  testsSummary: string
  credits: string
  kvWarmPct: number
  actionLabel: string
  targetRoute: MorningReportTargetRoute
}

export interface AutomationsState {
  running: OvernightRun[]
  schedules: AutomationSchedule[]
  reports: MorningHandoffReport[]
}

export interface LaunchOvernightInput {
  mission: string
  repo: string
  duration: string
  maxAgents: string
  permissionMode: string
  handoffTime: string
}
