import type {
  SwarmAgent,
  SwarmBoardMessage,
  SwarmPlanScope,
  SwarmState,
  SwarmWorktree,
} from "@/lib/ipc-client"

export type {
  SwarmAgent,
  SwarmBoardMessage,
  SwarmPlanScope,
  SwarmState,
  SwarmWorktree,
}

export type SwarmAgentState = SwarmAgent["state"]
export type SwarmTodoItem = SwarmAgent["todoLane"][number]
export type SwarmTodoStatus = SwarmTodoItem["status"]

export type SwarmLedgerTab = "board" | "plan" | "worktrees"

export interface SpawnWorkerInput {
  name: string
  role: string
  model: string
  worktree: string
  task: string
}

export interface SendDmInput {
  agentId: string
  message: string
}

export interface SwarmTelemetrySummary {
  totalAgents: number
  runningCount: number
  completedCount: number
  rootCount: number
  stoppedCount: number
  pausedCount: number
  worktreeCount: number
  conflictCount: number
  allWorkersPaused: boolean
  planLabel: string
  planVersionShort: string
}
