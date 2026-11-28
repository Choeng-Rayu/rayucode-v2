import { z } from "zod"

export const customizeTabSchema = z.enum(["plugins", "skills", "memory"])

export const pluginCategorySchema = z.enum([
  "featured",
  "popular",
  "noteworthy",
  "business",
])

export const pluginCatalogItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  category: pluginCategorySchema,
  heroDescription: z.string().optional(),
  installed: z.boolean(),
  infoOnly: z.boolean().optional(),
  infoToast: z.string().optional(),
  searchKeywords: z.string(),
  mcpServerId: z.string().optional(),
  sourcePath: z.string().optional(),
  scope: z.enum(["global", "workspace"]).optional(),
  transport: z.enum(["stdio", "url"]).optional(),
  type: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  headerKeys: z.array(z.string()).optional(),
  envKeys: z.array(z.string()).optional(),
  timeout: z.number().optional(),
  revision: z.string().optional(),
  isCustomMcp: z.boolean().optional(),
})

export const skillItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  scope: z.string().min(1),
  tokens: z.string().min(1),
  description: z.string().min(1),
  enabled: z.boolean(),
})

export const memoryFileItemSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  tokens: z.string().min(1),
  updatedAt: z.string().min(1),
  preview: z.string(),
})

export const mcpConfigErrorSchema = z.object({
  filePath: z.string().min(1),
  scope: z.enum(["global", "workspace"]),
  message: z.string().min(1),
})

export const pluginsStateSchema = z.object({
  featuredId: z.string().min(1),
  plugins: z.array(pluginCatalogItemSchema),
  skills: z.array(skillItemSchema),
  memories: z.array(memoryFileItemSchema),
  mcpConfigErrors: z.array(mcpConfigErrorSchema).optional(),
  revisions: z.record(z.string(), z.string()).optional(),
  lastWriteStatus: z
    .object({
      diskSaved: z.boolean(),
      daemonReloaded: z.boolean(),
      reloadError: z.string().optional(),
    })
    .optional(),
})

export const pluginSearchInputSchema = z.object({
  query: z.string().max(120, "Search query is too long"),
})
