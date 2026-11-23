export interface RealMcpBlueprint {
  id: string
  mcpServerId: string
  name: string
  developer: string
  tagline: string
  description: string
  overview: string
  category: "featured" | "popular" | "noteworthy" | "business"
  transport: "stdio" | "url"
  command?: string
  args?: string[]
  url?: string
  requiredEnv?: Array<{
    key: string
    label: string
    placeholder: string
  }>
  samplePrompts: readonly [string, string, string]
  websiteUrl: string
  docsUrl: string
  repoUrl?: string
  searchKeywords: string
}

/**
 * Real, executable MCP server integrations written directly to `~/.rayu/mcp.json`
 * (or workspace `.mcp.json`) in the exact schema loaded by `crates/rayucode-base/src/mcp`.
 */
export const REAL_MCP_BLUEPRINTS: readonly RealMcpBlueprint[] = [
  {
    id: "Context7 Docs",
    mcpServerId: "context7",
    name: "Context7 Docs",
    developer: "Upstash",
    tagline: "Bring live, version-accurate framework documentation into RayuCode",
    description: "Up-to-date framework & library documentation via MCP",
    overview:
      "Connects RayuCode to Upstash Context7 so the agent fetches current API references and code examples for React, Next.js, Rust crates, Tailwind, Prisma, and more instead of relying on stale training data.",
    category: "featured",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    samplePrompts: [
      "Look up the latest React 19 useActionState API docs and examples.",
      "Fetch Tailwind CSS v4 @theme configuration reference from Context7.",
      "Check Electron 45 sandboxed preload best practices via Context7.",
    ],
    websiteUrl: "https://context7.com",
    docsUrl: "https://github.com/upstash/context7",
    repoUrl: "https://github.com/upstash/context7",
    searchKeywords: "context7 docs documentation api react nextjs mcp",
  },
  {
    id: "Linear",
    mcpServerId: "linear",
    name: "Linear",
    developer: "Linear",
    tagline: "Bring your Linear workspace into RayuCode",
    description: "Manage issues, cycles, projects, and specs across Linear",
    overview:
      "The Linear plugin connects RayuCode directly to Linear's hosted MCP server. Find issues, read project updates, and create or update tickets without leaving your development workflow.",
    category: "featured",
    transport: "url",
    url: "https://mcp.linear.app/sse",
    samplePrompts: [
      "Show my assigned Linear issues, grouped by priority.",
      "Summarize recent updates to my Linear projects.",
      "Find Linear issues related to the code I am working on.",
    ],
    websiteUrl: "https://linear.app",
    docsUrl: "https://linear.app/docs/mcp",
    searchKeywords: "linear issues cycles project tracking remote sse mcp",
  },
  {
    id: "Notion",
    mcpServerId: "notion",
    name: "Notion",
    developer: "Notion",
    tagline: "Connect RayuCode to your Notion wiki, RFCs, and databases",
    description: "Search team wikis, RFC specs & sprint databases via MCP",
    overview:
      "Connects RayuCode to Notion's official MCP server so you can search engineering specs, summarize meeting notes, read product PRDs, and keep sprint trackers synced with code changes.",
    category: "featured",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    requiredEnv: [
      {
        key: "OPENAPI_MCP_HEADERS",
        label: "Notion Authorization Header JSON",
        placeholder:
          '{"Authorization":"Bearer ntn_...","Notion-Version":"2022-06-28"}',
      },
    ],
    samplePrompts: [
      "Search Notion for our latest architecture RFC and summarize key decisions.",
      "Find open action items from this week's engineering sync notes.",
      "Draft a Notion release summary from my current git branch.",
    ],
    websiteUrl: "https://www.notion.so",
    docsUrl: "https://github.com/makenotion/notion-mcp-server",
    repoUrl: "https://github.com/makenotion/notion-mcp-server",
    searchKeywords: "notion docs wiki database specs mcp",
  },
  {
    id: "GitHub",
    mcpServerId: "github",
    name: "GitHub",
    developer: "GitHub / MCP",
    tagline: "Triage issues, inspect pull requests, and search repositories",
    description: "Repositories, issues, pull requests & code search via MCP",
    overview:
      "Connects RayuCode to GitHub via the official MCP server. Inspect PR review comments, check failing CI runs, search repositories, and create issues or branches directly from chat.",
    category: "featured",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    requiredEnv: [
      {
        key: "GITHUB_PERSONAL_ACCESS_TOKEN",
        label: "GitHub Personal Access Token",
        placeholder: "ghp_...",
      },
    ],
    samplePrompts: [
      "List open pull requests in this repo that need my review.",
      "Summarize the failing CI checks on the latest PR.",
      "Find GitHub issues labeled bug that relate to authentication.",
    ],
    websiteUrl: "https://github.com",
    docsUrl: "https://github.com/modelcontextprotocol/servers",
    repoUrl: "https://github.com/modelcontextprotocol/servers",
    searchKeywords: "github git pr issues repositories ci mcp",
  },
  {
    id: "Supabase",
    mcpServerId: "supabase",
    name: "Supabase",
    developer: "Supabase",
    tagline: "Inspect schemas, RLS policies, and Edge logs in RayuCode",
    description: "Postgres schema, SQL queries, migrations & Edge Function logs",
    overview:
      "Connects RayuCode to your Supabase projects via the official Supabase MCP server. Query Postgres tables, audit Row Level Security policies, generate migrations, and debug Edge Function logs.",
    category: "featured",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@supabase/mcp-server-supabase@latest"],
    requiredEnv: [
      {
        key: "SUPABASE_ACCESS_TOKEN",
        label: "Supabase Personal Access Token",
        placeholder: "sbp_...",
      },
    ],
    samplePrompts: [
      "List tables and RLS policies in my Supabase database.",
      "Generate a SQL migration for adding workspace_id to sessions.",
      "Inspect recent errors in Supabase Edge Function logs.",
    ],
    websiteUrl: "https://supabase.com",
    docsUrl: "https://supabase.com/docs/guides/getting-started/mcp",
    repoUrl: "https://github.com/supabase-community/supabase-mcp",
    searchKeywords: "supabase postgres database rls migrations edge functions mcp",
  },
  {
    id: "Firebase",
    mcpServerId: "firebase",
    name: "Firebase",
    developer: "Google Firebase",
    tagline: "Inspect Firestore, Auth, Functions, and Hosting from RayuCode",
    description: "Firestore, Auth, Cloud Functions & Hosting via Firebase MCP",
    overview:
      "Runs the official Firebase CLI MCP server so RayuCode can inspect Firestore collections, security rules, Auth users, Cloud Functions logs, and preview deploys.",
    category: "featured",
    transport: "stdio",
    command: "npx",
    args: ["-y", "firebase-tools@latest", "experimental:mcp"],
    samplePrompts: [
      "Check my Firebase project configuration and security rules.",
      "Inspect recent Cloud Functions deployment logs.",
      "Verify Firestore indexes for our active queries.",
    ],
    websiteUrl: "https://firebase.google.com",
    docsUrl: "https://firebase.google.com/docs/cli/mcp-server",
    searchKeywords: "firebase firestore google auth functions hosting mcp",
  },
  {
    id: "Playwright",
    mcpServerId: "playwright",
    name: "Playwright",
    developer: "Microsoft",
    tagline: "Drive real browsers, verify UI flows, and capture screenshots",
    description: "Browser automation, DOM inspection & live screenshots via MCP",
    overview:
      "Connects RayuCode to Microsoft's Playwright MCP server for real headless or headed browser navigation, accessibility tree inspection, automated E2E verification, and screenshot capture.",
    category: "popular",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    samplePrompts: [
      "Open localhost:3000 in Playwright and verify the sign-in flow.",
      "Capture desktop and mobile screenshots of the dashboard page.",
      "Inspect console errors while navigating through settings.",
    ],
    websiteUrl: "https://playwright.dev",
    docsUrl: "https://github.com/microsoft/playwright-mcp",
    repoUrl: "https://github.com/microsoft/playwright-mcp",
    searchKeywords: "playwright browser e2e testing automation screenshots mcp",
  },
  {
    id: "Chrome DevTools",
    mcpServerId: "chrome-devtools",
    name: "Chrome DevTools",
    developer: "Chrome DevTools",
    tagline: "Debug live pages, network waterfalls, and Core Web Vitals",
    description: "Inspect live pages, network requests, console & CWV traces",
    overview:
      "Exposes Chrome DevTools Protocol inspection directly to RayuCode: audit Largest Contentful Paint, inspect failing network calls, debug cookies, and take heap or DOM snapshots.",
    category: "popular",
    transport: "stdio",
    command: "npx",
    args: ["-y", "chrome-devtools-mcp@latest"],
    samplePrompts: [
      "Inspect failed network requests on the currently open Chrome tab.",
      "Run a Core Web Vitals LCP trace on localhost:5173.",
      "Check console warnings and accessibility roles on this page.",
    ],
    websiteUrl: "https://developer.chrome.com/docs/devtools",
    docsUrl: "https://github.com/ChromeDevTools/chrome-devtools-mcp",
    repoUrl: "https://github.com/ChromeDevTools/chrome-devtools-mcp",
    searchKeywords: "chrome devtools browser debugging network performance mcp",
  },
  {
    id: "Sentry",
    mcpServerId: "sentry",
    name: "Sentry",
    developer: "Sentry",
    tagline: "Trace production exceptions back to exact commits in RayuCode",
    description: "Inspect production exceptions, stack frames & releases (remote MCP)",
    overview:
      "Connects RayuCode to Sentry's hosted MCP server. Pull live stack traces, correlate regressions with local source files, and draft targeted fixes with full error context.",
    category: "popular",
    transport: "url",
    url: "https://mcp.sentry.dev/sse",
    samplePrompts: [
      "Show the top 5 unresolved Sentry errors from the last 24 hours.",
      "Inspect the stack trace for the newest TypeError and locate the file.",
      "Compare error volume before and after our latest release.",
    ],
    websiteUrl: "https://sentry.io",
    docsUrl: "https://docs.sentry.io/product/sentry-mcp/",
    searchKeywords: "sentry errors crashes traces observability remote mcp",
  },
  {
    id: "Figma",
    mcpServerId: "figma",
    name: "Figma",
    developer: "Figma",
    tagline: "Read layout specs, component tokens, and design frames directly",
    description: "Inspect component specs, layout tokens & design frames (remote MCP)",
    overview:
      "Connects RayuCode to Figma's hosted MCP endpoint so you can pull spacing tokens, typography scales, and frame structures directly into your frontend implementation.",
    category: "noteworthy",
    transport: "url",
    url: "https://mcp.figma.com/mcp",
    samplePrompts: [
      "Extract color and typography tokens from the selected Figma frame.",
      "Inspect spacing and component hierarchy for our header redesign.",
      "Compare this React component against the Figma spec.",
    ],
    websiteUrl: "https://www.figma.com",
    docsUrl: "https://help.figma.com/hc/en-us/articles/32132100833559",
    searchKeywords: "figma design tokens ui frames components mcp",
  },
  {
    id: "PostgreSQL",
    mcpServerId: "postgres",
    name: "PostgreSQL",
    developer: "Model Context Protocol",
    tagline: "Run read-safe schema inspections and EXPLAIN plans",
    description: "Read-safe schema inspection & SQL query analysis via MCP",
    overview:
      "Provides read-only PostgreSQL schema inspection and query execution via MCP so RayuCode can verify columns, indexes, foreign keys, and query plans against your database.",
    category: "noteworthy",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    requiredEnv: [
      {
        key: "POSTGRES_CONNECTION_STRING",
        label: "PostgreSQL Connection URL",
        placeholder: "postgresql://user:pass@localhost:5432/mydb",
      },
    ],
    samplePrompts: [
      "Inspect the schema and indexes for the users and credits tables.",
      "Run EXPLAIN ANALYZE on our session lookup query.",
      "Check for missing foreign key indexes across public tables.",
    ],
    websiteUrl: "https://www.postgresql.org",
    docsUrl: "https://github.com/modelcontextprotocol/servers",
    repoUrl: "https://github.com/modelcontextprotocol/servers",
    searchKeywords: "postgres postgresql sql database schema mcp",
  },
  {
    id: "Cloudflare",
    mcpServerId: "cloudflare",
    name: "Cloudflare",
    developer: "Cloudflare",
    tagline: "Query Cloudflare Workers, KV, R2, and edge docs via MCP",
    description: "Cloudflare Workers, KV, R2 & docs via remote MCP",
    overview:
      "Connects RayuCode to Cloudflare's MCP server using mcp-remote so you can query live Workers documentation, KV/R2 configurations, and edge deployment guides.",
    category: "noteworthy",
    transport: "stdio",
    command: "npx",
    args: ["-y", "mcp-remote", "https://docs.mcp.cloudflare.com/sse"],
    samplePrompts: [
      "Check Cloudflare Workers Durable Objects alarms documentation.",
      "Review Wrangler configuration for R2 bucket bindings.",
      "Compare Cloudflare Queues vs Workflows for background jobs.",
    ],
    websiteUrl: "https://www.cloudflare.com",
    docsUrl: "https://developers.cloudflare.com/agents/model-context-protocol/",
    searchKeywords: "cloudflare workers kv r2 edge mcp",
  },
  {
    id: "Stripe",
    mcpServerId: "stripe",
    name: "Stripe",
    developer: "Stripe",
    tagline: "Inspect customers, prices, subscriptions, and webhooks",
    description: "Customers, products, invoices & webhook testing via Stripe MCP",
    overview:
      "Connects RayuCode to Stripe's official MCP server so you can inspect test-mode products, subscription prices, payment intents, and scaffold billing flows safely.",
    category: "business",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@stripe/mcp", "--tools=all"],
    requiredEnv: [
      {
        key: "STRIPE_SECRET_KEY",
        label: "Stripe Secret Key",
        placeholder: "sk_test_...",
      },
    ],
    samplePrompts: [
      "List active Stripe products and recurring price IDs in test mode.",
      "Inspect the latest failed payment intents and error codes.",
      "Verify our checkout webhook handler against Stripe event schemas.",
    ],
    websiteUrl: "https://stripe.com",
    docsUrl: "https://docs.stripe.com/building-with-llms",
    repoUrl: "https://github.com/stripe/agent-toolkit",
    searchKeywords: "stripe payments billing invoices webhooks mcp",
  },
]

export function findMcpBlueprint(
  idOrServerId: string
): RealMcpBlueprint | undefined {
  const target = idOrServerId.trim().toLowerCase()
  return REAL_MCP_BLUEPRINTS.find(
    (b) =>
      b.id.toLowerCase() === target || b.mcpServerId.toLowerCase() === target
  )
}
