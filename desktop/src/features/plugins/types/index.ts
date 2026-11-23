export type CustomizeTab = "plugins" | "skills" | "memory"

export type PluginCategory = "featured" | "popular" | "noteworthy" | "business"

export interface PluginCatalogItem {
  id: string
  name: string
  description: string
  category: PluginCategory
  heroDescription?: string
  installed: boolean
  infoOnly?: boolean
  infoToast?: string
  searchKeywords: string
}

export interface SkillItem {
  id: string
  name: string
  scope: string
  tokens: string
  description: string
  enabled: boolean
}

export interface MemoryFileItem {
  id: string
  path: string
  tokens: string
  updatedAt: string
  preview: string
}

export interface PluginsState {
  featuredId: string
  plugins: PluginCatalogItem[]
  skills: SkillItem[]
  memories: MemoryFileItem[]
}
