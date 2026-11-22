import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  pluginsQueryKeys,
  pluginsQueryOptions,
  prefetchPluginsState,
  setFeaturedPlugin,
  togglePluginInstall,
  toggleSkillEnabled,
} from "../api/plugins-api"
import type { PluginCatalogItem, PluginsState } from "../types"

export function usePluginsState() {
  return useQuery(pluginsQueryOptions())
}

export function usePrefetchPlugins() {
  const queryClient = useQueryClient()
  return () => {
    void prefetchPluginsState(queryClient)
  }
}

export function useTogglePluginInstall() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (plugin: PluginCatalogItem) => {
      if (plugin.infoOnly) {
        return Promise.resolve(null)
      }
      return togglePluginInstall(plugin.id)
    },
    onSuccess: (result, plugin) => {
      if (plugin.infoOnly) {
        toast.info(
          plugin.infoToast ?? `${plugin.name} requires system permission`
        )
        return
      }
      if (!result) return
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      queryClient.setQueryData<PluginsState>(
        pluginsQueryKeys.state(),
        result.data
      )
      const updated = result.data.plugins.find((p) => p.id === plugin.id)
      if (updated) {
        toast(
          updated.installed
            ? `Connected ${updated.name}`
            : `Disconnected ${updated.name}`
        )
      }
    },
  })
}

export function useSetFeaturedPlugin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (pluginId: string) => setFeaturedPlugin(pluginId),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      queryClient.setQueryData<PluginsState>(
        pluginsQueryKeys.state(),
        result.data
      )
    },
  })
}

export function useToggleSkill() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (skillId: string) => {
      const current = queryClient.getQueryData<PluginsState>(
        pluginsQueryKeys.state()
      )
      return toggleSkillEnabled(skillId, current)
    },
    onSuccess: (result, skillId) => {
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      queryClient.setQueryData<PluginsState>(
        pluginsQueryKeys.state(),
        result.data
      )
      const updated = result.data.skills.find((s) => s.id === skillId)
      if (updated) {
        toast(
          updated.enabled
            ? `Enabled skill ${updated.name}`
            : `Disabled skill ${updated.name}`
        )
      }
    },
  })
}
