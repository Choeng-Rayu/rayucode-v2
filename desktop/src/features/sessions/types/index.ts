import type {
  GettingStartedItem,
  ModelOption,
  PermissionModeId,
  PermissionModeOption,
  ProjectGroup,
  PromptImageAttachment,
  ReasoningEffort,
  SessionSummary,
} from "@/lib/ipc-client"

export type {
  GettingStartedItem,
  ModelOption,
  PermissionModeId,
  PermissionModeOption,
  ProjectGroup,
  PromptImageAttachment,
  ReasoningEffort,
  SessionSummary,
}

export type ComposerMode = "home" | "workspace"

export interface EffortStopConfig {
  index: number
  level: ReasoningEffort
  description: string
  progress: number
}

export interface SlashCommandItem {
  command: string
  insertText: string
  description: string
}

export interface QuickStartSuggestion {
  id: string
  label: string
  prompt: string
  kind: "code" | "swarm" | "preview" | "sheet"
}

export interface CreateSessionInput {
  prompt: string
  project?: string
  workingDir?: string
  checkout?: string
  modelId?: string
  modelLabel?: string
  effort?: ReasoningEffort
  permissionMode?: PermissionModeId
}

export interface ComposerSubmitPayload {
  prompt: string
  images?: PromptImageAttachment[]
  project: string
  checkout: string
  modelId: string
  modelLabel: string
  effort: ReasoningEffort
  permissionMode: PermissionModeId
}
