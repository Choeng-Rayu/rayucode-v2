import { queryOptions, type QueryClient } from "@tanstack/react-query"

import { err, ok, type ActionResult } from "@/lib/action-result"
import { ipcClient } from "@/lib/ipc-client"

import { pluginsStateSchema } from "../schemas"
import type { PluginsState } from "../types"

interface ExtendedPluginsBridge {
  toggleSkill?: (skillId: string) => Promise<PluginsState>
}

export const pluginsQueryKeys = {
  all: ["plugins"] as const,
  state: () => [...pluginsQueryKeys.all, "state"] as const,
}

export async function fetchPluginsState(): Promise<PluginsState> {
  const raw = await ipcClient.plugins.getState()
  return pluginsStateSchema.parse(raw)
}

export function pluginsQueryOptions() {
  return queryOptions({
    queryKey: pluginsQueryKeys.state(),
    queryFn: fetchPluginsState,
    staleTime: 30_000,
  })
}

export function prefetchPluginsState(client: QueryClient): Promise<void> {
  return client.prefetchQuery(pluginsQueryOptions())
}

export async function togglePluginInstall(
  pluginId: string
): Promise<ActionResult<PluginsState>> {
  if (!pluginId.trim()) {
    return err("Plugin ID is required")
  }
  try {
    const raw = await ipcClient.plugins.toggleInstall(pluginId)
    return ok(pluginsStateSchema.parse(raw))
  } catch (error) {
    return err(
      error instanceof Error ? error.message : "Failed to update plugin state"
    )
  }
}

export async function setFeaturedPlugin(
  pluginId: string
): Promise<ActionResult<PluginsState>> {
  if (!pluginId.trim()) {
    return err("Plugin ID is required")
  }
  try {
    const raw = await ipcClient.plugins.setFeatured(pluginId)
    return ok(pluginsStateSchema.parse(raw))
  } catch (error) {
    return err(
      error instanceof Error
        ? error.message
        : "Failed to switch featured plugin"
    )
  }
}

export async function toggleSkillEnabled(
  skillId: string,
  currentState?: PluginsState
): Promise<ActionResult<PluginsState>> {
  if (!skillId.trim()) {
    return err("Skill ID is required")
  }
  try {
    const bridge = ipcClient.plugins as typeof ipcClient.plugins &
      ExtendedPluginsBridge
    if (typeof bridge.toggleSkill === "function") {
      const raw = await bridge.toggleSkill(skillId)
      return ok(pluginsStateSchema.parse(raw))
    }

    const baseState = currentState ?? (await fetchPluginsState())
    const nextState: PluginsState = {
      ...baseState,
      skills: baseState.skills.map((skill) =>
        skill.id === skillId ? { ...skill, enabled: !skill.enabled } : skill
      ),
    }
    return ok(pluginsStateSchema.parse(nextState))
  } catch (error) {
    return err(
      error instanceof Error ? error.message : "Failed to toggle skill"
    )
  }
}
