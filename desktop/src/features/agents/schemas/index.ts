import { z } from "zod"

import type {
  AgentEffortChoice,
  AgentPersonaPreset,
  AgentRoleMeta,
} from "../types"

export const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/

export const RESERVED_PROFILE_NAMES = new Set([
  "inherit",
  "coordinator",
  "default",
])

export const agentRoleIdSchema = z.enum([
  "swarm",
  "review",
  "judge",
  "memory",
  "ambient",
])

export const agentScopeSchema = z.enum(["global", "session"])

export const agentEffortSchema = z.enum([
  "auto",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
])

export const agentProfileItemSchema = z.object({
  name: z.string().min(1),
  model: z.string().min(1),
  description: z.string(),
  effort: z.string().nullable(),
  scope: agentScopeSchema,
})

export const agentsRouteOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  provider: z.string(),
  model: z.string().min(1),
  modelSpec: z.string().min(1),
  available: z.boolean(),
})

const roleRecordSchema = z.object({
  swarm: z.string().nullable(),
  review: z.string().nullable(),
  judge: z.string().nullable(),
  memory: z.string().nullable(),
  ambient: z.string().nullable(),
})

export const agentsStateSchema = z.object({
  sessionId: z.string().nullable(),
  subagentModel: z.string().nullable(),
  inheritModel: z.string().nullable(),
  defaults: roleRecordSchema,
  overrides: roleRecordSchema,
  effective: roleRecordSchema,
  profiles: z.array(agentProfileItemSchema),
  globalProfiles: z.array(agentProfileItemSchema),
  sessionProfiles: z.array(agentProfileItemSchema),
  swarmAllowlist: z.array(z.string()),
  models: z.array(z.string()),
  routes: z.array(agentsRouteOptionSchema),
  configPath: z.string().min(1),
  daemonConnected: z.boolean(),
  daemonError: z.string().nullable(),
})

export const upsertAgentProfileInputSchema = z.object({
  name: z
    .string()
    .trim()
    .transform((v) => v.toLowerCase())
    .refine(
      (v) => v.length >= 1 && v.length <= 32,
      "Name must be between 1 and 32 characters"
    )
    .refine(
      (v) => PROFILE_NAME_PATTERN.test(v),
      "Use lowercase letters, digits, '-' or '_' (starting with a letter or digit)"
    )
    .refine(
      (v) => !RESERVED_PROFILE_NAMES.has(v),
      "Name cannot be 'inherit', 'coordinator', or 'default'"
    ),
  model: z.string().trim().min(1, "Select or enter a model route"),
  effort: agentEffortSchema.default("auto"),
  description: z
    .string()
    .trim()
    .max(500, "Persona brief must be under 500 characters")
    .default(""),
  scope: agentScopeSchema,
})

export const AGENT_ROLE_DEFINITIONS: readonly AgentRoleMeta[] = [
  {
    id: "swarm",
    label: "Swarm Workers",
    configKey: "agents.swarm_model",
    description:
      "Default model or persona assigned to delegated swarm & subagent workers.",
  },
  {
    id: "review",
    label: "Code Review",
    configKey: "autoreview.model",
    description:
      "Reviews patches, catches regressions, and runs /review and autoreview passes.",
  },
  {
    id: "judge",
    label: "Acceptance Judge",
    configKey: "autojudge.model",
    description:
      "Verifies acceptance criteria, test coverage, and completion gates (/judge).",
  },
  {
    id: "memory",
    label: "Memory Extraction",
    configKey: "agents.memory_model",
    description:
      "Extracts durable facts, project rules, and semantic context across sessions.",
  },
  {
    id: "ambient",
    label: "Ambient Cycles",
    configKey: "ambient.model",
    description:
      "Runs background wake cycles, health checks, and overnight maintenance.",
  },
] as const

export const AGENT_EFFORT_OPTIONS: readonly {
  value: AgentEffortChoice
  label: string
}[] = [
  { value: "auto", label: "Auto (model default)" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
  { value: "max", label: "Max" },
] as const

export const AGENT_PERSONA_PRESETS: readonly AgentPersonaPreset[] = [
  {
    name: "coder",
    label: "Implementation Coder",
    effort: "medium",
    description:
      "Focused feature implementation, surgical edits, refactoring, and targeted unit tests.",
    preferredModelHint: "sonnet",
  },
  {
    name: "architect",
    label: "Systems Architect",
    effort: "high",
    description:
      "Deep design tradeoffs, cross-crate API boundaries, concurrency review, and root-cause debugging.",
    preferredModelHint: "opus",
  },
  {
    name: "research",
    label: "Codebase Researcher",
    effort: "medium",
    description:
      "Read-only codebase exploration, long-document analysis, dependency audits, and API discovery.",
    preferredModelHint: "gemini",
  },
  {
    name: "reviewer",
    label: "Security & Quality Reviewer",
    effort: "high",
    description:
      "Strict diff review for regressions, edge cases, access-control checks, and test completeness.",
    preferredModelHint: "opus",
  },
  {
    name: "fast-triage",
    label: "Fast Triage & Fixes",
    effort: "low",
    description:
      "High-throughput log triage, formatting checks, quick grep lookups, and mechanical updates.",
    preferredModelHint: "mini",
  },
] as const
