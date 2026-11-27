import type {
  AgentProfileItem,
  AgentRoleId,
  AgentsRouteOption,
  AgentsState,
} from "@/lib/ipc-client"

export type { AgentProfileItem, AgentRoleId, AgentsRouteOption, AgentsState }

export type AgentScope = "global" | "session"

export type AgentEffortChoice =
  | "auto"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"

export interface AgentRoleMeta {
  id: AgentRoleId
  label: string
  configKey: string
  description: string
}

export interface AgentPersonaPreset {
  name: string
  label: string
  effort: AgentEffortChoice
  description: string
  preferredModelHint: string
}

export interface UpsertAgentProfileInput {
  name: string
  model: string
  effort: AgentEffortChoice
  description: string
  scope: AgentScope
}
