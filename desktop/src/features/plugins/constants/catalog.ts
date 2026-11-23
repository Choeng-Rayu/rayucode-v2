import type {
  CustomizeTab,
  PluginCatalogItem,
  PluginCategory,
} from "../types"

export const PLUGIN_CATEGORY_SECTIONS: ReadonlyArray<{
  id: PluginCategory
  label: string
  subtitle: string
}> = [
  {
    id: "featured",
    label: "Featured",
    subtitle: "Core MCP integrations for docs, issues, repos, wikis, and databases.",
  },
  {
    id: "popular",
    label: "Developer & Browser",
    subtitle: "Browser automation, Chrome DevTools debugging, and error monitoring.",
  },
  {
    id: "noteworthy",
    label: "Design & Infrastructure",
    subtitle: "Design tokens, PostgreSQL schema inspection, and edge deployments.",
  },
  {
    id: "business",
    label: "Business",
    subtitle: "Payments, subscriptions, billing, and workflow automation.",
  },
]

export const CUSTOMIZE_NAV_ITEMS: ReadonlyArray<{
  id: CustomizeTab
  label: string
  subtitle?: string
}> = [
  { id: "plugins", label: "Plugins" },
  { id: "skills", label: "Skills" },
  { id: "memory", label: "Memory", subtitle: "CLAUDE.md · AGENTS.md · GEMINI.md" },
]

export const OFFICIAL_CONNECTOR_NAMES = [
  "GitHub",
  "Linear",
  "Slack",
  "Notion",
  "Sentry",
  "Context7 Docs",
  "Figma",
  "PostgreSQL",
  "Stripe",
  "Cloudflare",
  "Supabase",
  "Vercel",
  "Jira",
  "Confluence",
  "Google Drive",
  "Playwright",
] as const

export type OfficialConnectorName = (typeof OFFICIAL_CONNECTOR_NAMES)[number]

export const DEFAULT_HERO_DESCRIPTIONS: Record<string, string> = {
  Firebase:
    "Inspect Firestore collections, Auth users, Cloud Functions logs, and deploy preview channels directly from RayuCode via MCP.",
  Supabase:
    "Query Postgres tables, inspect RLS policies, run migrations, and tail Edge Function logs straight from your RayuCode workspace.",
  Dynatrace:
    "Investigate production issues with real Dynatrace data: problems and root causes, logs, metrics, traces, and vulnerabilities, via skills and the MCP...",
  Notion:
    "Search team wikis, sync RFC specs into Markdown previews, and update sprint databases automatically as RayuCode ships PRs.",
  Linear:
    "Triage cycles, pull issue context directly into your prompt, and auto-link RayuCode Swarm branches and pull requests.",
  Stripe:
    "Inspect payment intents, test webhooks locally, and scaffold billing & checkout flows with real Stripe API schemas.",
  "Context7 Docs":
    "Resolve live library IDs and pull up-to-date framework API docs straight into your RayuCode context window.",
  GitHub:
    "Triage pull requests, inspect CI check failures, review diffs, and publish releases directly from RayuCode.",
  Sentry:
    "Trace production exceptions, inspect stack frames, and correlate regressions with recent commits via MCP.",
  Slack:
    "Summarize engineering channels, post release updates, and pull thread context without leaving RayuCode.",
  Figma:
    "Inspect component tokens, layout specs, and design variables from Figma frames directly inside your coding loop.",
  PostgreSQL:
    "Run read-safe schema inspections, explain query plans, and verify migrations against your local or staging Postgres.",
  Cloudflare:
    "Inspect Workers, KV namespaces, R2 buckets, and tail edge logs directly from RayuCode.",
  Vercel:
    "Check preview deployments, inspect build logs, and manage environment variables across projects.",
  Jira:
    "Query sprint boards, transition tickets, and link RayuCode swarm branches to Jira workitems.",
  Confluence:
    "Read architecture PRDs, search engineering runbooks, and keep technical docs synced with shipped changes.",
  "Google Drive":
    "Read Docs, Sheets, and Slides context directly inside your RayuCode workspace.",
  Playwright:
    "Drive headless browser verifications, capture responsive screenshots, and inspect console traces.",
}

const PREFERRED_HERO_IDS = [
  "Firebase",
  "Supabase",
  "Dynatrace",
  "Notion",
  "Linear",
  "Stripe",
  "Context7 Docs",
  "GitHub",
  "Sentry",
  "Figma",
  "Cloudflare",
  "Vercel",
]

export function selectFeaturedShowcaseTiles(
  plugins: readonly PluginCatalogItem[],
  featuredId: string
): PluginCatalogItem[] {
  const byId = new Map(plugins.map((p) => [p.id, p]))
  const selected: PluginCatalogItem[] = []
  const seen = new Set<string>()

  const pushUnique = (item: PluginCatalogItem | undefined) => {
    if (!item || seen.has(item.id) || selected.length >= 6) return
    seen.add(item.id)
    selected.push(item)
  }

  for (const id of PREFERRED_HERO_IDS) {
    if (byId.has(id)) {
      pushUnique(byId.get(id))
    }
  }

  for (const plugin of plugins) {
    if (plugin.category === "featured") {
      pushUnique(plugin)
    }
  }

  for (const plugin of plugins) {
    pushUnique(plugin)
  }

  const active = byId.get(featuredId)
  if (active && !seen.has(active.id)) {
    if (selected.length >= 6) {
      selected[2] = active
    } else {
      selected.push(active)
    }
  }

  return selected
}

export function filterPluginsByQuery(
  plugins: readonly PluginCatalogItem[],
  rawQuery: string
): PluginCatalogItem[] {
  const normalized = rawQuery.trim().toLowerCase()
  if (!normalized) return [...plugins]

  return plugins.filter((plugin) => {
    const haystack = [
      plugin.name,
      plugin.description,
      plugin.searchKeywords,
      plugin.category,
    ]
      .join(" ")
      .toLowerCase()
    return haystack.includes(normalized)
  })
}
