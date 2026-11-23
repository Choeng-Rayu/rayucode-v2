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
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  envKeys: z.array(z.string()).optional(),
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

export const pluginsStateSchema = z.object({
  featuredId: z.string().min(1),
  plugins: z.array(pluginCatalogItemSchema),
  skills: z.array(skillItemSchema),
  memories: z.array(memoryFileItemSchema),
})

export const pluginSearchInputSchema = z.object({
  query: z.string().max(120, "Search query is too long"),
})
