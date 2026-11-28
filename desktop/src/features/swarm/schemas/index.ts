import { z } from "zod"

import { shellCommandStepSchema } from "@/features/execution-trace"

export const swarmAgentStateSchema = z.enum([
  "coordinating",
  "running",
  "completed",
  "paused",
  "stopped",
])

export const swarmTodoItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  status: z.enum(["done", "now", "pending"]),
})

export const swarmAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  worktree: z.string().min(1),
  state: swarmAgentStateSchema,
  task: z.string(),
  model: z.string().min(1),
  laneProgressLabel: z.string(),
  duration: z.string(),
  reportsTo: z.string().optional(),
  todoLane: z.array(swarmTodoItemSchema),
  commands: z.array(shellCommandStepSchema),
  readFiles: z.array(z.string()).optional(),
  note: z.string().optional(),
})

export const swarmBoardMessageSchema = z.object({
  id: z.string().min(1),
  time: z.string(),
  from: z.string().min(1),
  to: z.string().min(1),
  text: z.string(),
  tag: z.string(),
  isOk: z.boolean().optional(),
})

export const swarmPlanScopeSchema = z.object({
  id: z.string().min(1),
  scopeLabel: z.string().min(1),
  ownerRoute: z.string().min(1),
  description: z.string(),
  statusTag: z.string(),
  isOk: z.boolean().optional(),
})

export const swarmWorktreeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  branch: z.string().min(1),
  owner: z.string().min(1),
  file: z.string().min(1),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
})

export const swarmStateSchema = z.object({
  swarmId: z.string().min(1),
  title: z.string().min(1),
  planVersion: z.string().min(1),
  credits: z.string(),
  kvCachePct: z.number(),
  agents: z.array(swarmAgentSchema),
  messages: z.array(swarmBoardMessageSchema),
  planScopes: z.array(swarmPlanScopeSchema),
  worktrees: z.array(swarmWorktreeSchema),
  available: z.boolean().optional(),
  unavailableReason: z.string().optional(),
})

export const spawnWorkerInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Worker name must be at least 2 characters")
    .max(32, "Worker name must be at most 32 characters")
    .regex(
      /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
      "Use letters, numbers, hyphens, or underscores only"
    ),
  role: z.string().trim().min(1, "Select or enter a worker role"),
  model: z.string().trim().min(1, "Select a model"),
  worktree: z.string().trim().min(1, "Select a workspace worktree"),
  task: z
    .string()
    .trim()
    .min(4, "Describe the todo lane task (at least 4 characters)"),
})

export const toggleAgentStateInputSchema = z.object({
  agentId: z.string().trim().min(1, "Agent ID is required"),
})

export const sendDmInputSchema = z.object({
  agentId: z.string().trim().min(1, "Target agent is required"),
  message: z.string().trim().min(1, "Steering message cannot be empty"),
})
