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
  mcpServerId?: string
  sourcePath?: string
  scope?: "global" | "workspace"
  transport?: "stdio" | "url"
  type?: string
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  headerKeys?: string[]
  envKeys?: string[]
  timeout?: number
  revision?: string
  isCustomMcp?: boolean
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
  mcpConfigErrors?: Array<{
    filePath: string
    scope: "global" | "workspace"
    message: string
  }>
  revisions?: Record<string, string>
  lastWriteStatus?: {
    diskSaved: boolean
    daemonReloaded: boolean
    reloadError?: string
  }
}
