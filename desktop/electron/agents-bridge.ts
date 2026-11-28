import type { RuntimeCommand } from "@rayu-dev/rayucode-sdk"

export type AgentRoleId = "swarm" | "review" | "judge" | "memory" | "ambient"

export interface AgentProfileItem {
  name: string
  model: string
  description: string
  effort: string | null
  scope: "global" | "session"
}

export interface AgentsRouteOption {
  id: string
  label: string
  provider: string
  model: string
  modelSpec: string
  available: boolean
}

export interface AgentsState {
  sessionId: string | null
  subagentModel: string | null
  inheritModel: string | null
  defaults: Record<AgentRoleId, string | null>
  overrides: Record<AgentRoleId, string | null>
  effective: Record<AgentRoleId, string | null>
  profiles: AgentProfileItem[]
  globalProfiles: AgentProfileItem[]
  sessionProfiles: AgentProfileItem[]
  swarmAllowlist: string[]
  models: string[]
  routes: AgentsRouteOption[]
  configPath: string
  daemonConnected: boolean
  daemonError: string | null
}

export interface AgentsDaemonAdapter {
  runtimeCommand(
    sessionId: string,
    command: RuntimeCommand,
    args?: string[]
  ): Promise<{ command: RuntimeCommand; data: unknown; message: string }>
  runGlobalRuntimeCommand?(
    command: RuntimeCommand,
    args?: string[],
    workingDir?: string
  ): Promise<{ command: RuntimeCommand; data: unknown; message: string }>
  runRuntimeCommandOnAnySession(
    command: RuntimeCommand,
    args?: string[],
    workingDir?: string
  ): Promise<{ command: RuntimeCommand; data: unknown; message: string }>
  getRuntimeInfo?: (
    sessionId: string
  ) => Promise<{
    model?: string
    provider?: string
    routes?: Array<{
      id?: string
      model?: string
      provider?: string
      provider_label?: string
      label?: string
      available?: boolean
      api_method?: string
    }>
  } | null>
  listSessions?: (
    includeArchived?: boolean
  ) => Promise<Array<{ session_id?: string }>>
}

const ROLE_IDS: readonly AgentRoleId[] = [
  "swarm",
  "review",
  "judge",
  "memory",
  "ambient",
]

function emptyRoleRecord(): Record<AgentRoleId, string | null> {
  return {
    swarm: null,
    review: null,
    judge: null,
    memory: null,
    ambient: null,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function parseRoleRecord(raw: unknown): Record<AgentRoleId, string | null> {
  const rec = asRecord(raw)
  const out = emptyRoleRecord()
  for (const role of ROLE_IDS) {
    const val = rec[role]
    out[role] =
      typeof val === "string" && val.trim().length > 0 ? val.trim() : null
  }
  return out
}

function parseProfileItem(
  raw: unknown,
  fallbackScope: "global" | "session"
): AgentProfileItem | null {
  const rec = asRecord(raw)
  const name = typeof rec.name === "string" ? rec.name.trim() : ""
  const model = typeof rec.model === "string" ? rec.model.trim() : ""
  if (!name || !model) return null
  const scopeRaw = rec.scope
  const scope: "global" | "session" =
    scopeRaw === "global" || scopeRaw === "session" ? scopeRaw : fallbackScope
  const effort =
    typeof rec.effort === "string" && rec.effort.trim().length > 0
      ? rec.effort.trim()
      : null
  const description =
    typeof rec.description === "string" ? rec.description.trim() : ""
  return { name, model, description, effort, scope }
}

function parseProfileList(
  raw: unknown,
  fallbackScope: "global" | "session"
): AgentProfileItem[] {
  if (!Array.isArray(raw)) return []
  const items: AgentProfileItem[] = []
  for (const entry of raw) {
    const parsed = parseProfileItem(entry, fallbackScope)
    if (parsed) items.push(parsed)
  }
  return items
}

function formatModelSpec(model: string, provider: string): string {
  if (model.includes(":")) return model
  const normalizedProvider = provider.trim().toLowerCase()
  if (!normalizedProvider) return model
  if (
    normalizedProvider === "rayu" ||
    normalizedProvider === "rayu-cloud" ||
    normalizedProvider === "subscription"
  ) {
    return `rayu:${model}`
  }
  return `${normalizedProvider}:${model}`
}

function isLiveDaemonSessionId(sessionId?: string | null): sessionId is string {
  return Boolean(
    sessionId &&
      sessionId.trim().length > 0 &&
      !sessionId.trim().startsWith("ses_")
  )
}

export class RayuAgentsManager {
  constructor(
    private readonly daemonClient: AgentsDaemonAdapter,
    private readonly getWorkingDir: () => string
  ) {}

  private async runCommand(
    command: RuntimeCommand,
    args: string[],
    sessionId?: string | null
  ): Promise<{ command: RuntimeCommand; data: unknown; message: string }> {
    const isGlobalCommand = args[0] === "global"
    if (!isGlobalCommand && isLiveDaemonSessionId(sessionId)) {
      return this.daemonClient.runtimeCommand(sessionId.trim(), command, args)
    }
    if (typeof this.daemonClient.runGlobalRuntimeCommand === "function") {
      return this.daemonClient.runGlobalRuntimeCommand(
        command,
        args,
        this.getWorkingDir()
      )
    }
    return this.daemonClient.runRuntimeCommandOnAnySession(
      command,
      args,
      this.getWorkingDir()
    )
  }

  private async resolveSessionId(
    requestedSessionId?: string | null
  ): Promise<string | null> {
    if (isLiveDaemonSessionId(requestedSessionId)) {
      return requestedSessionId.trim()
    }
    if (this.daemonClient.listSessions) {
      try {
        const list = await this.daemonClient.listSessions(false)
        const first = list[0]?.session_id
        if (isLiveDaemonSessionId(first)) return first.trim()
      } catch {
        // ignore
      }
    }
    return null
  }

  async getState(sessionId?: string | null): Promise<AgentsState> {
    try {
      const targetSessionId = await this.resolveSessionId(sessionId)
      const [agentsRes, subagentRes, runtimeInfo] = await Promise.all([
        this.runCommand("agents", ["status"], targetSessionId),
        this.runCommand("subagent_model", ["status"], targetSessionId).catch(
          () => ({ command: "subagent_model" as RuntimeCommand, data: {}, message: "" })
        ),
        targetSessionId && this.daemonClient.getRuntimeInfo
          ? this.daemonClient.getRuntimeInfo(targetSessionId).catch(() => null)
          : Promise.resolve(null),
      ])

      const data = asRecord(agentsRes.data)
      const subData = asRecord(subagentRes.data)

      const defaults = parseRoleRecord(data.defaults)
      const overrides = parseRoleRecord(data.overrides)
      const effectiveRaw = parseRoleRecord(data.effective)
      const effective = emptyRoleRecord()
      for (const role of ROLE_IDS) {
        effective[role] =
          effectiveRaw[role] ?? overrides[role] ?? defaults[role] ?? null
      }

      const globalProfiles = parseProfileList(data.global_profiles, "global")
      const sessionProfiles = parseProfileList(data.session_profiles, "session")
      const profiles = parseProfileList(data.profiles, "global")

      const mergedProfiles =
        profiles.length > 0
          ? profiles
          : [
              ...globalProfiles.filter(
                (gp) =>
                  !sessionProfiles.some(
                    (sp) => sp.name.toLowerCase() === gp.name.toLowerCase()
                  )
              ),
              ...sessionProfiles,
            ]

      const models = Array.isArray(data.models)
        ? data.models
            .map((m) => String(m).trim())
            .filter((m) => m.length > 0)
        : []

      const swarmAllowlist = Array.isArray(data.swarm_allowlist)
        ? data.swarm_allowlist
            .map((m) => String(m).trim())
            .filter((m) => m.length > 0)
        : []

      const routes: AgentsRouteOption[] = []
      const seenSpecs = new Set<string>()
      if (runtimeInfo?.routes && Array.isArray(runtimeInfo.routes)) {
        for (const r of runtimeInfo.routes) {
          const model = (r.model ?? r.id ?? "").trim()
          const provider = (r.provider ?? "rayu").trim()
          if (!model) continue
          const modelSpec = formatModelSpec(model, provider)
          if (seenSpecs.has(modelSpec)) continue
          seenSpecs.add(modelSpec)
          routes.push({
            id: (r.id ?? modelSpec).trim(),
            label: (r.label ?? model).trim(),
            provider,
            model,
            modelSpec,
            available: r.available !== false,
          })
        }
      }
      for (const modelSpec of models) {
        if (seenSpecs.has(modelSpec)) continue
        seenSpecs.add(modelSpec)
        const colonIdx = modelSpec.indexOf(":")
        const provider = colonIdx > 0 ? modelSpec.slice(0, colonIdx) : "default"
        const model = colonIdx > 0 ? modelSpec.slice(colonIdx + 1) : modelSpec
        routes.push({
          id: modelSpec,
          label: model,
          provider,
          model,
          modelSpec,
          available: true,
        })
      }

      const subagentModel =
        typeof subData.model === "string" && subData.model.trim()
          ? subData.model.trim()
          : typeof data.subagent_model === "string" &&
              data.subagent_model.trim()
            ? data.subagent_model.trim()
            : null

      const inheritModel =
        typeof subData.inherit_model === "string" &&
        subData.inherit_model.trim()
          ? subData.inherit_model.trim()
          : typeof data.inherit_model === "string" && data.inherit_model.trim()
            ? data.inherit_model.trim()
            : runtimeInfo?.model?.trim() || null

      return {
        sessionId: targetSessionId,
        subagentModel,
        inheritModel,
        defaults,
        overrides,
        effective,
        profiles: mergedProfiles,
        globalProfiles,
        sessionProfiles,
        swarmAllowlist,
        models,
        routes,
        configPath:
          typeof data.config_path === "string" && data.config_path.trim()
            ? data.config_path.trim()
            : "~/.rayu/config.toml",
        daemonConnected: true,
        daemonError: null,
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Rust daemon is offline"
      return {
        sessionId: sessionId ?? null,
        subagentModel: null,
        inheritModel: null,
        defaults: emptyRoleRecord(),
        overrides: emptyRoleRecord(),
        effective: emptyRoleRecord(),
        profiles: [],
        globalProfiles: [],
        sessionProfiles: [],
        swarmAllowlist: [],
        models: [],
        routes: [],
        configPath: "~/.rayu/config.toml",
        daemonConnected: false,
        daemonError: message,
      }
    }
  }

  async setRoleModel(input: {
    role: AgentRoleId
    model: string
    scope: "global" | "session"
    sessionId?: string | null
  }): Promise<AgentsState> {
    const args =
      input.scope === "global"
        ? ["global", input.role, input.model.trim()]
        : [input.role, input.model.trim()]
    await this.runCommand("agents", args, input.sessionId)
    return this.getState(input.sessionId)
  }

  async setSubagentModel(input: {
    model: string
    scope?: "global" | "session"
    sessionId?: string | null
  }): Promise<AgentsState> {
    const args =
      input.scope === "global"
        ? ["global", input.model.trim()]
        : [input.model.trim()]
    await this.runCommand("subagent_model", args, input.sessionId)
    return this.getState(input.sessionId)
  }

  async upsertProfile(input: {
    name: string
    model: string
    effort?: string | null
    description?: string
    scope: "global" | "session"
    sessionId?: string | null
  }): Promise<AgentsState> {
    const args: string[] = []
    if (input.scope === "global") {
      args.push("global")
    }
    args.push("profile", "add", input.name.trim(), input.model.trim())
    const effort = input.effort?.trim()
    if (effort && effort !== "auto" && effort !== "none") {
      args.push("--effort", effort)
    }
    const description = input.description?.trim()
    if (description) {
      if (description.startsWith("-")) {
        args.push("--")
      }
      args.push(description)
    }
    await this.runCommand("agents", args, input.sessionId)
    return this.getState(input.sessionId)
  }

  async deleteProfile(input: {
    name: string
    scope: "global" | "session"
    sessionId?: string | null
  }): Promise<AgentsState> {
    const args =
      input.scope === "global"
        ? ["global", "profile", "rm", input.name.trim()]
        : ["profile", "rm", input.name.trim()]
    await this.runCommand("agents", args, input.sessionId)
    return this.getState(input.sessionId)
  }
}
