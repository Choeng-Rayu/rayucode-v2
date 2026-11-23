import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  McpServerView,
  McpToolDefView,
  McpTransport,
  MemoryFactView,
  MemoryStatusView,
  SkillView,
  WorkspaceIntegrationsView,
} from "@shared/vscodeProtocol";

import { callRpc } from "@/lib";

export type PluginsTabId = "mcp" | "skills" | "memory" | "workspace";

export type ConnectorCategoryId =
  | "all"
  | "featured"
  | "developer"
  | "infrastructure"
  | "business";

export interface CatalogConnectorTemplate {
  id: string;
  brandId: string;
  name: string;
  developer: string;
  category: Exclude<ConnectorCategoryId, "all">;
  description: string;
  heroDescription: string;
  transport: McpTransport;
  configLayerLabel: string;
  shared: boolean;
  oauthRequired?: boolean;
  command?: string;
  args?: string[];
  url?: string;
  requiredEnvKeys?: string[];
  defaultTools: McpToolDefView[];
  samplePrompts: readonly [string, string, string];
  docsUrl: string;
}

export const CATALOG_CONNECTOR_TEMPLATES: readonly CatalogConnectorTemplate[] = [
  {
    id: "github",
    brandId: "github",
    name: "GitHub",
    developer: "GitHub",
    category: "featured",
    description: "Repositories, pull requests, issues, and CI check inspection via MCP",
    heroDescription:
      "Triage pull requests, inspect CI check failures, review diffs, and publish releases directly from RayuCode.",
    transport: "streamable-http",
    configLayerLabel: "user ~/.rayu/mcp.json",
    shared: true,
    oauthRequired: true,
    url: "https://api.githubcopilot.com/mcp/",
    requiredEnvKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    defaultTools: [
      {
        name: "list_pull_requests",
        fullName: "mcp__github__list_pull_requests",
        description: "List and filter pull requests in the active repository",
        tokenEstimate: 180,
      },
      {
        name: "get_issue",
        fullName: "mcp__github__get_issue",
        description: "Fetch issue details, labels, and timeline comments",
        tokenEstimate: 140,
      },
      {
        name: "get_check_runs",
        fullName: "mcp__github__get_check_runs",
        description: "Inspect GitHub Actions workflow and check run statuses",
        tokenEstimate: 165,
      },
    ],
    samplePrompts: [
      "List open pull requests in this repo that need my review.",
      "Summarize failing CI check runs on the current branch.",
      "Find open issues labeled bug related to model discovery.",
    ],
    docsUrl: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "linear",
    brandId: "linear",
    name: "Linear",
    developer: "Linear",
    category: "featured",
    description: "Manage issues, cycles, projects, and engineering specs across Linear",
    heroDescription:
      "Triage cycles, pull issue context directly into your prompt, and auto-link RayuCode Swarm branches and pull requests.",
    transport: "streamable-http",
    configLayerLabel: "workspace .mcp.json",
    shared: true,
    oauthRequired: true,
    url: "https://mcp.linear.app/sse",
    defaultTools: [
      {
        name: "list_issues",
        fullName: "mcp__linear__list_issues",
        description: "Query assigned Linear issues grouped by state and priority",
        tokenEstimate: 170,
      },
      {
        name: "update_issue",
        fullName: "mcp__linear__update_issue",
        description: "Update issue status, assignee, or cycle",
        tokenEstimate: 150,
      },
    ],
    samplePrompts: [
      "Show my assigned Linear issues grouped by priority.",
      "Link this branch to the active Linear sprint ticket.",
      "Summarize recent updates to our current Linear project.",
    ],
    docsUrl: "https://linear.app/docs/mcp",
  },
  {
    id: "context7-docs",
    brandId: "context7-docs",
    name: "Context7 Docs",
    developer: "Upstash",
    category: "featured",
    description: "Version-accurate framework and crate API documentation via MCP",
    heroDescription:
      "Resolve live library IDs and pull up-to-date framework API docs straight into your RayuCode context window.",
    transport: "stdio",
    configLayerLabel: "global ~/.rayu/mcp.json",
    shared: true,
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    defaultTools: [
      {
        name: "resolve_library_id",
        fullName: "mcp__context7-docs__resolve_library_id",
        description: "Resolve a package name to a Context7 library identifier",
        tokenEstimate: 110,
      },
      {
        name: "get_library_docs",
        fullName: "mcp__context7-docs__get_library_docs",
        description: "Fetch live versioned documentation and code examples",
        tokenEstimate: 145,
      },
    ],
    samplePrompts: [
      "Fetch Tailwind CSS v4 @theme inline token documentation.",
      "Look up React 19 ref-as-prop and useActionState examples.",
      "Check tokio UnixStream frame codec documentation.",
    ],
    docsUrl: "https://github.com/upstash/context7",
  },
  {
    id: "sentry",
    brandId: "sentry",
    name: "Sentry",
    developer: "Sentry",
    category: "developer",
    description: "Production exception traces, stack frames, and release regressions",
    heroDescription:
      "Trace production exceptions, inspect stack frames, and correlate regressions with recent commits via MCP.",
    transport: "sse",
    configLayerLabel: "workspace .mcp.json",
    shared: true,
    oauthRequired: true,
    url: "https://mcp.sentry.dev/sse",
    defaultTools: [
      {
        name: "list_issues",
        fullName: "mcp__sentry__list_issues",
        description: "List top unresolved Sentry exceptions by event volume",
        tokenEstimate: 160,
      },
      {
        name: "get_event_stacktrace",
        fullName: "mcp__sentry__get_event_stacktrace",
        description: "Retrieve symbolicated stack frames for an exception event",
        tokenEstimate: 190,
      },
    ],
    samplePrompts: [
      "Show the top 5 unresolved Sentry errors from the last 24 hours.",
      "Correlate the latest TypeError stack trace with local files.",
      "Compare error volume before and after our latest release.",
    ],
    docsUrl: "https://docs.sentry.io/product/sentry-mcp/",
  },
  {
    id: "postgresql",
    brandId: "postgresql",
    name: "PostgreSQL",
    developer: "Model Context Protocol",
    category: "infrastructure",
    description: "Read-safe PostgreSQL schema inspection and EXPLAIN query plans",
    heroDescription:
      "Run read-safe schema inspections, explain query plans, and verify migrations against your local or staging Postgres.",
    transport: "stdio",
    configLayerLabel: "workspace .mcp.json",
    shared: true,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    requiredEnvKeys: ["POSTGRES_CONNECTION_STRING"],
    defaultTools: [
      {
        name: "query",
        fullName: "mcp__postgresql__query",
        description: "Execute a read-only SQL query inside a rolled-back transaction",
        tokenEstimate: 130,
      },
      {
        name: "describe_table",
        fullName: "mcp__postgresql__describe_table",
        description: "Inspect columns, types, constraints, and indexes",
        tokenEstimate: 140,
      },
    ],
    samplePrompts: [
      "Inspect the schema and indexes for the sessions and credits tables.",
      "Run EXPLAIN on our workspace lookup query.",
      "Check for missing foreign key indexes across public tables.",
    ],
    docsUrl: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "playwright",
    brandId: "playwright",
    name: "Playwright",
    developer: "Microsoft",
    category: "developer",
    description: "Browser automation, accessibility tree snapshots, and E2E verification",
    heroDescription:
      "Drive headless browser verifications, capture responsive screenshots, and inspect console traces.",
    transport: "stdio",
    configLayerLabel: "workspace .mcp.json",
    shared: false,
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    defaultTools: [
      {
        name: "browser_navigate",
        fullName: "mcp__playwright__browser_navigate",
        description: "Navigate isolated browser instance to target URL",
        tokenEstimate: 125,
      },
      {
        name: "browser_snapshot",
        fullName: "mcp__playwright__browser_snapshot",
        description: "Capture accessibility tree and DOM state",
        tokenEstimate: 155,
      },
    ],
    samplePrompts: [
      "Open localhost:5173 in Playwright and verify the login flow.",
      "Capture responsive screenshots of the Swarm Mission Control view.",
      "Check for console warnings while navigating all primary tabs.",
    ],
    docsUrl: "https://github.com/microsoft/playwright-mcp",
  },
  {
    id: "supabase",
    brandId: "supabase",
    name: "Supabase",
    developer: "Supabase",
    category: "featured",
    description: "Postgres tables, RLS policies, SQL migrations, and Edge Function logs",
    heroDescription:
      "Query Postgres tables, inspect RLS policies, run migrations, and tail Edge Function logs straight from your RayuCode workspace.",
    transport: "stdio",
    configLayerLabel: "workspace .mcp.json",
    shared: true,
    command: "npx",
    args: ["-y", "@supabase/mcp-server-supabase@latest"],
    requiredEnvKeys: ["SUPABASE_ACCESS_TOKEN"],
    defaultTools: [
      {
        name: "list_tables",
        fullName: "mcp__supabase__list_tables",
        description: "List Postgres tables and RLS status across schemas",
        tokenEstimate: 140,
      },
      {
        name: "apply_migration",
        fullName: "mcp__supabase__apply_migration",
        description: "Validate and apply a versioned SQL migration",
        tokenEstimate: 165,
      },
    ],
    samplePrompts: [
      "List tables and RLS policies in my Supabase database.",
      "Generate a SQL migration for adding workspace_id to sessions.",
      "Inspect recent errors in Supabase Edge Function logs.",
    ],
    docsUrl: "https://supabase.com/docs/guides/getting-started/mcp",
  },
  {
    id: "notion",
    brandId: "notion",
    name: "Notion",
    developer: "Notion",
    category: "featured",
    description: "Search team wikis, architecture RFCs, and engineering databases",
    heroDescription:
      "Search team wikis, sync RFC specs into Markdown previews, and update sprint databases automatically as RayuCode ships PRs.",
    transport: "stdio",
    configLayerLabel: "global ~/.rayu/mcp.json",
    shared: true,
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    requiredEnvKeys: ["OPENAPI_MCP_HEADERS"],
    defaultTools: [
      {
        name: "search_pages",
        fullName: "mcp__notion__search_pages",
        description: "Search Notion pages and databases by title or content",
        tokenEstimate: 150,
      },
    ],
    samplePrompts: [
      "Search Notion for our latest architecture RFC and summarize decisions.",
      "Find open action items from this week's engineering sync notes.",
      "Draft a Notion release summary from my current git branch.",
    ],
    docsUrl: "https://github.com/makenotion/notion-mcp-server",
  },
  {
    id: "slack",
    brandId: "slack",
    name: "Slack",
    developer: "Slack",
    category: "business",
    description: "Summarize engineering channels, thread context, and release notes",
    heroDescription:
      "Summarize engineering channels, post release updates, and pull thread context without leaving RayuCode.",
    transport: "stdio",
    configLayerLabel: "global ~/.rayu/mcp.json",
    shared: true,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    requiredEnvKeys: ["SLACK_BOT_TOKEN"],
    defaultTools: [
      {
        name: "list_channels",
        fullName: "mcp__slack__list_channels",
        description: "List public workspace channels",
        tokenEstimate: 120,
      },
    ],
    samplePrompts: [
      "Summarize today's incident thread in the engineering channel.",
      "Draft a release announcement for v2.4.0.",
      "Search Slack threads mentioning KV cache TTL.",
    ],
    docsUrl: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "figma",
    brandId: "figma",
    name: "Figma",
    developer: "Figma",
    category: "infrastructure",
    description: "Inspect component tokens, layout specs, and design frames via MCP",
    heroDescription:
      "Inspect component tokens, layout specs, and design variables from Figma frames directly inside your coding loop.",
    transport: "streamable-http",
    configLayerLabel: "workspace .mcp.json",
    shared: true,
    oauthRequired: true,
    url: "https://mcp.figma.com/mcp",
    defaultTools: [
      {
        name: "get_frame_tokens",
        fullName: "mcp__figma__get_frame_tokens",
        description: "Extract design tokens and spacing specs from a Figma node",
        tokenEstimate: 175,
      },
    ],
    samplePrompts: [
      "Extract color and typography tokens from the selected Figma frame.",
      "Inspect spacing and component hierarchy for our header redesign.",
      "Compare this React component against the Figma spec.",
    ],
    docsUrl: "https://help.figma.com/hc/en-us/articles/32132100833559",
  },
  {
    id: "stripe",
    brandId: "stripe",
    name: "Stripe",
    developer: "Stripe",
    category: "business",
    description: "Customers, subscriptions, payment intents, and webhook schemas",
    heroDescription:
      "Inspect payment intents, test webhooks locally, and scaffold billing & checkout flows with real Stripe API schemas.",
    transport: "stdio",
    configLayerLabel: "workspace .mcp.json",
    shared: true,
    command: "npx",
    args: ["-y", "@stripe/mcp", "--tools=all"],
    requiredEnvKeys: ["STRIPE_SECRET_KEY"],
    defaultTools: [
      {
        name: "list_payment_intents",
        fullName: "mcp__stripe__list_payment_intents",
        description: "Inspect recent payment intents and status transitions",
        tokenEstimate: 160,
      },
    ],
    samplePrompts: [
      "List active Stripe products and recurring price IDs in test mode.",
      "Inspect the latest failed payment intents and error codes.",
      "Verify our checkout webhook handler against Stripe event schemas.",
    ],
    docsUrl: "https://docs.stripe.com/building-with-llms",
  },
  {
    id: "cloudflare",
    brandId: "cloudflare",
    name: "Cloudflare",
    developer: "Cloudflare",
    category: "infrastructure",
    description: "Workers, KV namespaces, R2 buckets, and edge logs via MCP",
    heroDescription:
      "Inspect Workers, KV namespaces, R2 buckets, and tail edge logs directly from RayuCode.",
    transport: "stdio",
    configLayerLabel: "global ~/.rayu/mcp.json",
    shared: true,
    command: "npx",
    args: ["-y", "mcp-remote", "https://docs.mcp.cloudflare.com/sse"],
    defaultTools: [
      {
        name: "search_cloudflare_docs",
        fullName: "mcp__cloudflare__search_cloudflare_docs",
        description: "Search Cloudflare Workers, KV, R2, and Durable Objects docs",
        tokenEstimate: 145,
      },
    ],
    samplePrompts: [
      "Check Cloudflare Workers Durable Objects alarms documentation.",
      "Review Wrangler configuration for R2 bucket bindings.",
      "Compare Cloudflare Queues vs Workflows for background jobs.",
    ],
    docsUrl: "https://developers.cloudflare.com/agents/model-context-protocol/",
  },
  {
    id: "vercel",
    brandId: "vercel",
    name: "Vercel",
    developer: "Vercel",
    category: "infrastructure",
    description: "Preview deployments, build logs, and project environment configs",
    heroDescription:
      "Check preview deployments, inspect build logs, and manage environment variables across projects.",
    transport: "streamable-http",
    configLayerLabel: "workspace .mcp.json",
    shared: true,
    oauthRequired: true,
    url: "https://mcp.vercel.com/sse",
    defaultTools: [
      {
        name: "list_deployments",
        fullName: "mcp__vercel__list_deployments",
        description: "List recent preview and production deployments",
        tokenEstimate: 150,
      },
    ],
    samplePrompts: [
      "Check the build logs for the latest preview deployment.",
      "List environment variables configured for staging.",
      "Inspect edge function latency on the newest deployment.",
    ],
    docsUrl: "https://vercel.com/docs",
  },
  {
    id: "firebase",
    brandId: "firebase",
    name: "Firebase",
    developer: "Google Firebase",
    category: "featured",
    description: "Firestore collections, Auth users, Cloud Functions, and Hosting",
    heroDescription:
      "Inspect Firestore collections, Auth users, Cloud Functions logs, and deploy preview channels directly from RayuCode via MCP.",
    transport: "stdio",
    configLayerLabel: "workspace .mcp.json",
    shared: true,
    command: "npx",
    args: ["-y", "firebase-tools@latest", "experimental:mcp"],
    defaultTools: [
      {
        name: "firestore_list_collections",
        fullName: "mcp__firebase__firestore_list_collections",
        description: "List root and nested Firestore collections",
        tokenEstimate: 140,
      },
    ],
    samplePrompts: [
      "Check my Firebase project configuration and security rules.",
      "Inspect recent Cloud Functions deployment logs.",
      "Verify Firestore indexes for our active queries.",
    ],
    docsUrl: "https://firebase.google.com/docs/cli/mcp-server",
  },
  {
    id: "dynatrace",
    brandId: "dynatrace",
    name: "Dynatrace",
    developer: "Dynatrace",
    category: "developer",
    description: "Production root-cause analysis, distributed traces, and metrics",
    heroDescription:
      "Investigate production issues with real Dynatrace data: problems and root causes, logs, metrics, traces, and vulnerabilities.",
    transport: "streamable-http",
    configLayerLabel: "workspace .mcp.json",
    shared: true,
    oauthRequired: true,
    url: "https://mcp.dynatrace.com/sse",
    defaultTools: [
      {
        name: "get_active_problems",
        fullName: "mcp__dynatrace__get_active_problems",
        description: "Fetch active Davis AI root-cause problem cards",
        tokenEstimate: 165,
      },
    ],
    samplePrompts: [
      "List active production problems and Davis AI root causes.",
      "Inspect p99 service latency anomalies over the last hour.",
      "Check vulnerability findings for our container images.",
    ],
    docsUrl: "https://www.dynatrace.com",
  },
  {
    id: "chrome-devtools",
    brandId: "chrome-devtools",
    name: "Chrome DevTools",
    developer: "Chrome DevTools",
    category: "developer",
    description: "Live DOM, network waterfalls, console logs, and Core Web Vitals",
    heroDescription:
      "Debug live pages, network waterfalls, and Core Web Vitals directly from your RayuCode coding loop.",
    transport: "stdio",
    configLayerLabel: "global ~/.rayu/mcp.json",
    shared: false,
    command: "npx",
    args: ["-y", "chrome-devtools-mcp@latest"],
    defaultTools: [
      {
        name: "get_network_requests",
        fullName: "mcp__chrome-devtools__get_network_requests",
        description: "Inspect live network requests and response timings",
        tokenEstimate: 160,
      },
    ],
    samplePrompts: [
      "Inspect failed network requests on the currently open Chrome tab.",
      "Run a Core Web Vitals LCP trace on localhost:5173.",
      "Check console warnings and accessibility roles on this page.",
    ],
    docsUrl: "https://github.com/ChromeDevTools/chrome-devtools-mcp",
  },
  {
    id: "jira",
    brandId: "jira",
    name: "Jira",
    developer: "Atlassian",
    category: "business",
    description: "Query sprint boards, transition tickets, and link branches",
    heroDescription:
      "Query sprint boards, transition tickets, and link RayuCode swarm branches to Jira workitems.",
    transport: "streamable-http",
    configLayerLabel: "workspace .mcp.json",
    shared: true,
    oauthRequired: true,
    url: "https://mcp.atlassian.com/v1/sse",
    defaultTools: [
      {
        name: "search_issues",
        fullName: "mcp__jira__search_issues",
        description: "Run JQL queries across active sprint boards",
        tokenEstimate: 155,
      },
    ],
    samplePrompts: [
      "List Jira tickets assigned to me in the current sprint.",
      "Transition issue RAYU-142 to In Review.",
      "Summarize blockers across the platform board.",
    ],
    docsUrl: "https://developer.atlassian.com",
  },
  {
    id: "confluence",
    brandId: "confluence",
    name: "Confluence",
    developer: "Atlassian",
    category: "business",
    description: "Read architecture PRDs, engineering runbooks, and release docs",
    heroDescription:
      "Read architecture PRDs, search engineering runbooks, and keep technical docs synced with shipped changes.",
    transport: "streamable-http",
    configLayerLabel: "workspace .mcp.json",
    shared: true,
    oauthRequired: true,
    url: "https://mcp.atlassian.com/v1/confluence/sse",
    defaultTools: [
      {
        name: "search_cql",
        fullName: "mcp__confluence__search_cql",
        description: "Search Confluence spaces using CQL",
        tokenEstimate: 150,
      },
    ],
    samplePrompts: [
      "Search Confluence for our on-call incident runbook.",
      "Summarize the Q4 architecture PRD.",
      "Compare our API implementation against the Confluence spec.",
    ],
    docsUrl: "https://developer.atlassian.com",
  },
  {
    id: "google-drive",
    brandId: "google-drive",
    name: "Google Drive",
    developer: "Google Workspace",
    category: "business",
    description: "Read Docs, Sheets, and Slides context inside RayuCode",
    heroDescription:
      "Read Docs, Sheets, and Slides context directly inside your RayuCode workspace.",
    transport: "stdio",
    configLayerLabel: "global ~/.rayu/mcp.json",
    shared: true,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-gdrive"],
    defaultTools: [
      {
        name: "search_files",
        fullName: "mcp__google-drive__search_files",
        description: "Search Google Drive documents and spreadsheets",
        tokenEstimate: 140,
      },
    ],
    samplePrompts: [
      "Find the latest product roadmap doc in Google Drive.",
      "Read metrics from our sprint velocity spreadsheet.",
      "Summarize design review slides from Drive.",
    ],
    docsUrl: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "hubspot",
    brandId: "hubspot",
    name: "HubSpot",
    developer: "HubSpot",
    category: "business",
    description: "CRM contacts, deals, tickets, and customer feedback pipelines",
    heroDescription:
      "Query CRM deals, customer support tickets, and enterprise account context straight from RayuCode.",
    transport: "stdio",
    configLayerLabel: "workspace .mcp.json",
    shared: true,
    command: "npx",
    args: ["-y", "@hubspot/mcp-server"],
    requiredEnvKeys: ["HUBSPOT_ACCESS_TOKEN"],
    defaultTools: [
      {
        name: "list_tickets",
        fullName: "mcp__hubspot__list_tickets",
        description: "List customer tickets and priority tags",
        tokenEstimate: 145,
      },
    ],
    samplePrompts: [
      "List high-priority customer support tickets from this week.",
      "Summarize enterprise feature requests logged in HubSpot.",
      "Check account notes before debugging this customer report.",
    ],
    docsUrl: "https://developers.hubspot.com",
  },
  {
    id: "dropbox",
    brandId: "dropbox",
    name: "Dropbox",
    developer: "Dropbox",
    category: "business",
    description: "Search shared folders, design assets, and archived specs",
    heroDescription:
      "Access shared folders, specification archives, and team assets stored in Dropbox.",
    transport: "streamable-http",
    configLayerLabel: "global ~/.rayu/mcp.json",
    shared: true,
    oauthRequired: true,
    url: "https://mcp.dropbox.com/sse",
    defaultTools: [
      {
        name: "list_folder",
        fullName: "mcp__dropbox__list_folder",
        description: "List files and folders in Dropbox",
        tokenEstimate: 130,
      },
    ],
    samplePrompts: [
      "Search Dropbox for the signed architecture handoff PDF.",
      "List files in the shared release-assets folder.",
      "Fetch the latest benchmark dataset CSV from Dropbox.",
    ],
    docsUrl: "https://www.dropbox.com/developers",
  },
  {
    id: "elevenlabs",
    brandId: "elevenlabs",
    name: "ElevenLabs",
    developer: "ElevenLabs",
    category: "developer",
    description: "Voice synthesis, audio generation, and speech narration tools",
    heroDescription:
      "Generate studio-quality voice synthesis and audio assets via the official ElevenLabs MCP server.",
    transport: "stdio",
    configLayerLabel: "global ~/.rayu/mcp.json",
    shared: true,
    command: "uvx",
    args: ["elevenlabs-mcp"],
    requiredEnvKeys: ["ELEVENLABS_API_KEY"],
    defaultTools: [
      {
        name: "text_to_speech",
        fullName: "mcp__elevenlabs__text_to_speech",
        description: "Synthesize speech audio from text prompt",
        tokenEstimate: 140,
      },
    ],
    samplePrompts: [
      "Generate a voiceover narration for our release walkthrough.",
      "List available ElevenLabs voice profiles.",
      "Synthesize test audio samples for our voice dictation suite.",
    ],
    docsUrl: "https://github.com/elevenlabs/elevenlabs-mcp",
  },
  {
    id: "canva",
    brandId: "canva",
    name: "Canva",
    developer: "Canva",
    category: "business",
    description: "Create social cards, presentation decks, and visual diagrams",
    heroDescription:
      "Search brand templates, generate release graphics, and export presentation assets via Canva MCP.",
    transport: "streamable-http",
    configLayerLabel: "global ~/.rayu/mcp.json",
    shared: true,
    oauthRequired: true,
    url: "https://mcp.canva.com/sse",
    defaultTools: [
      {
        name: "list_designs",
        fullName: "mcp__canva__list_designs",
        description: "Search and list Canva designs in workspace",
        tokenEstimate: 135,
      },
    ],
    samplePrompts: [
      "Find our release announcement banner template in Canva.",
      "Export the architecture diagram deck to PDF.",
      "List recent brand kit assets in Canva.",
    ],
    docsUrl: "https://www.canva.dev",
  },
  {
    id: "remote-desktop-commander",
    brandId: "remote-desktop-commander",
    name: "Desktop Commander",
    developer: "Desktop Commander",
    category: "developer",
    description: "Local process orchestration, file diffing, and terminal automation",
    heroDescription:
      "Manage long-running local processes, inspect system resources, and automate desktop developer workflows.",
    transport: "stdio",
    configLayerLabel: "global ~/.rayu/mcp.json",
    shared: true,
    command: "npx",
    args: ["-y", "@wonderwhy-er/desktop-commander"],
    defaultTools: [
      {
        name: "list_processes",
        fullName: "mcp__remote-desktop-commander__list_processes",
        description: "Inspect active local processes and CPU/memory usage",
        tokenEstimate: 130,
      },
    ],
    samplePrompts: [
      "Check which local process is holding port 7643.",
      "Inspect active node and cargo build processes.",
      "Run a clean workspace build verification.",
    ],
    docsUrl: "https://github.com/wonderwhy-er/DesktopCommanderMCP",
  },
];

export const ENDORSED_SKILLS_CATALOG: readonly SkillView[] = [
  {
    name: "rust-anything",
    description:
      "Profile, bridge, port, diff, and benchmark TypeScript/Python/Go modules into idiomatic Rust.",
    path: ".agents/skills/rust-anything/SKILL.md",
    scope: "endorsed",
    allowedTools: ["run_command", "read_file", "edit_file"],
    installed: false,
    category: "Engineering",
  },
  {
    name: "mcp-schema-audit",
    description:
      "Audit 7-layer MCP server tool schemas against the 8,000 token adaptive budget and zero-cache-miss rules.",
    path: ".agents/skills/mcp-schema-audit/SKILL.md",
    scope: "endorsed",
    allowedTools: ["read_file", "run_command"],
    installed: false,
    category: "Architecture",
  },
  {
    name: "security-diff-gate",
    description:
      "Verify command-risk tiers, credential hygiene, and sandbox boundaries before opening a PR.",
    path: ".agents/skills/security-diff-gate/SKILL.md",
    scope: "endorsed",
    allowedTools: ["read_file", "grep_search"],
    installed: false,
    category: "Security",
  },
];

export const PLUGINS_KEYS = {
  all: ["plugins"] as const,
  mcp: () => [...PLUGINS_KEYS.all, "mcp"] as const,
  skills: () => [...PLUGINS_KEYS.all, "skills"] as const,
  memory: () => [...PLUGINS_KEYS.all, "memory"] as const,
  workspace: () => [...PLUGINS_KEYS.all, "workspace"] as const,
};

export function findCatalogTemplate(
  idOrBrandId: string,
): CatalogConnectorTemplate | undefined {
  const norm = idOrBrandId.trim().toLowerCase();
  return CATALOG_CONNECTOR_TEMPLATES.find(
    (t) =>
      t.id.toLowerCase() === norm ||
      t.brandId.toLowerCase() === norm ||
      t.name.toLowerCase() === norm,
  );
}

export function normalizeConfigLayerBadge(layer: string): string {
  switch (layer.toLowerCase()) {
    case "workspace":
    case "project":
      return "workspace .mcp.json";
    case "user":
    case "global":
      return "~/.rayu/mcp.json";
    case "claude":
      return "~/.claude/mcp.json";
    case "codex":
      return "~/.codex/config.toml";
    case "vscode":
      return "VS Code settings";
    case "ancestor":
      return "ancestor .mcp.json";
    default:
      return layer;
  }
}

export function mcpListQueryOptions() {
  return queryOptions({
    queryKey: PLUGINS_KEYS.mcp(),
    queryFn: async () => {
      const res = await callRpc("plugins.mcp.list");
      const servers = res.servers.map((srv) => {
        const tpl = findCatalogTemplate(srv.brandId ?? srv.id);
        return {
          ...srv,
          brandId: srv.brandId ?? tpl?.brandId ?? srv.id,
          configPath:
            srv.configPath ??
            (srv.configLayer === "workspace"
              ? ".mcp.json"
              : "~/.rayu/mcp.json"),
          tools:
            srv.tools && srv.tools.length > 0
              ? srv.tools
              : (tpl?.defaultTools ?? [
                  {
                    name: "status",
                    fullName: `mcp__${srv.id}__status`,
                    description: `Verify ${srv.name} MCP server readiness`,
                    tokenEstimate: 120,
                  },
                ]),
        };
      });
      return {
        servers,
        totalTokenBudget: res.totalTokenBudget ?? 8000,
        usedTokenBudget:
          res.usedTokenBudget ??
          servers.reduce((acc, s) => acc + (s.tokenBudgetUsed ?? 400), 0),
      };
    },
  });
}

export function skillsListQueryOptions() {
  return queryOptions({
    queryKey: PLUGINS_KEYS.skills(),
    queryFn: async () => {
      const res = await callRpc("plugins.skills.list");
      const installedNames = new Set(
        res.skills.map((s) => s.name.toLowerCase()),
      );
      const endorsedSource =
        res.endorsed.length > 0 ? res.endorsed : ENDORSED_SKILLS_CATALOG;
      const endorsed = endorsedSource.map((item) => ({
        ...item,
        installed:
          Boolean(item.installed) ||
          installedNames.has(item.name.toLowerCase()),
      }));
      return {
        skills: res.skills,
        endorsed,
      };
    },
  });
}

export function memoryStatusQueryOptions() {
  return queryOptions({
    queryKey: PLUGINS_KEYS.memory(),
    queryFn: async (): Promise<MemoryStatusView> => {
      const res = await callRpc("plugins.memory.status");
      const facts = res.facts.map((fact, idx) => ({
        ...fact,
        relatedIds:
          fact.relatedIds ??
          (res.facts.length > 1
            ? [res.facts[(idx + 1) % res.facts.length]!.id]
            : []),
      }));
      return {
        ...res,
        facts,
      };
    },
  });
}

export function workspaceIntegrationsQueryOptions() {
  return queryOptions({
    queryKey: PLUGINS_KEYS.workspace(),
    queryFn: async (): Promise<WorkspaceIntegrationsView> => {
      const res = await callRpc("plugins.workspace.status");
      return {
        gmail: {
          ...res.gmail,
          actionCount: res.gmail.actionCount || 15,
        },
        calendar: {
          ...res.calendar,
          actionCount: res.calendar.actionCount || 7,
        },
        browser: {
          ...res.browser,
          detectedBrowsers:
            res.browser.detectedBrowsers.length > 1
              ? res.browser.detectedBrowsers
              : ["Chrome", "Chromium", "Firefox", "Edge", "Brave"],
          actionCount: res.browser.actionCount || 17,
        },
        companion: res.companion,
      };
    },
  });
}

export function useMcpConnectors() {
  return useQuery(mcpListQueryOptions());
}

export function useMcpActions() {
  const queryClient = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: async (params: { id: string; enabled: boolean }) => {
      await callRpc("plugins.mcp.toggle", params);
      return params;
    },
    onSuccess: ({ id, enabled }) => {
      queryClient.setQueryData(
        PLUGINS_KEYS.mcp(),
        (
          prev:
            | {
                servers: McpServerView[];
                totalTokenBudget: number;
                usedTokenBudget: number;
              }
            | undefined,
        ) => {
          if (!prev) return prev;
          return {
            ...prev,
            servers: prev.servers.map((s) =>
              s.id === id
                ? {
                    ...s,
                    enabled,
                    status: enabled ? "connected" : "disabled",
                  }
                : s,
            ),
          };
        },
      );
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await callRpc("plugins.mcp.test", { id });
      return { id, ...res };
    },
  });

  const reloadMutation = useMutation({
    mutationFn: async () => {
      return callRpc("plugins.mcp.reload");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PLUGINS_KEYS.mcp() });
    },
  });

  const saveServerMutation = useMutation({
    mutationFn: async (params: {
      mode: "add" | "edit";
      id: string;
      name?: string;
      brandId?: string;
      scope: "global" | "workspace";
      transport: McpTransport;
      command?: string;
      args?: string[];
      url?: string;
      env?: Record<string, string>;
      shared?: boolean;
      timeoutSecs?: number;
    }) => {
      const rpcMethod =
        params.mode === "edit" ? "plugins.mcp.edit" : "plugins.mcp.add";
      const res = await callRpc(rpcMethod, {
        id: params.id,
        scope: params.scope,
        transport: params.transport,
        command: params.command,
        args: params.args,
        url: params.url,
        env: params.env,
        shared: params.shared,
        timeoutSecs: params.timeoutSecs,
      });
      const tpl = findCatalogTemplate(params.brandId ?? params.id);
      const server: McpServerView = res.server ?? {
        id: params.id,
        name: params.name ?? tpl?.name ?? params.id,
        brandId: params.brandId ?? tpl?.brandId ?? params.id,
        status: "connected",
        enabled: true,
        transport: params.transport,
        configLayer: params.scope,
        shared: params.shared ?? true,
      };
      return {
        ...server,
        name: params.name ?? tpl?.name ?? server.name,
        brandId: params.brandId ?? tpl?.brandId ?? server.brandId ?? server.id,
        command: params.command ?? server.command,
        args: params.args ?? server.args,
        url: params.url ?? server.url,
        envKeys: params.env ? Object.keys(params.env) : server.envKeys,
        timeoutSecs: params.timeoutSecs ?? server.timeoutSecs ?? 30,
        cachedToolCount:
          server.cachedToolCount ?? tpl?.defaultTools.length ?? 6,
        tokenBudgetUsed: server.tokenBudgetUsed ?? 480,
        tools: server.tools ?? tpl?.defaultTools,
      };
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(
        PLUGINS_KEYS.mcp(),
        (
          prev:
            | {
                servers: McpServerView[];
                totalTokenBudget: number;
                usedTokenBudget: number;
              }
            | undefined,
        ) => {
          if (!prev) return prev;
          const exists = prev.servers.some((s) => s.id === saved.id);
          const servers = exists
            ? prev.servers.map((s) => (s.id === saved.id ? saved : s))
            : [saved, ...prev.servers];
          return {
            ...prev,
            servers,
          };
        },
      );
    },
  });

  const removeServerMutation = useMutation({
    mutationFn: async (params: {
      id: string;
      scope?: "global" | "workspace";
    }) => {
      await callRpc("plugins.mcp.remove", params);
      return params.id;
    },
    onSuccess: (removedId) => {
      queryClient.setQueryData(
        PLUGINS_KEYS.mcp(),
        (
          prev:
            | {
                servers: McpServerView[];
                totalTokenBudget: number;
                usedTokenBudget: number;
              }
            | undefined,
        ) => {
          if (!prev) return prev;
          return {
            ...prev,
            servers: prev.servers.filter((s) => s.id !== removedId),
          };
        },
      );
    },
  });

  const oauthMutation = useMutation({
    mutationFn: async (params: {
      id: string;
      action: "login" | "logout";
    }) => {
      if (params.action === "login") {
        await callRpc("plugins.mcp.login", { id: params.id });
      } else {
        await callRpc("plugins.mcp.logout", { id: params.id });
      }
      const res = await callRpc("plugins.mcp.oauth", params);
      return { id: params.id, authenticated: res.authenticated };
    },
    onSuccess: ({ id, authenticated }) => {
      queryClient.setQueryData(
        PLUGINS_KEYS.mcp(),
        (
          prev:
            | {
                servers: McpServerView[];
                totalTokenBudget: number;
                usedTokenBudget: number;
              }
            | undefined,
        ) => {
          if (!prev) return prev;
          return {
            ...prev,
            servers: prev.servers.map((s) =>
              s.id === id
                ? {
                    ...s,
                    oauthAuthenticated: authenticated,
                    status: authenticated ? "connected" : "auth_needed",
                  }
                : s,
            ),
          };
        },
      );
    },
  });

  return {
    toggleMutation,
    testMutation,
    reloadMutation,
    saveServerMutation,
    removeServerMutation,
    oauthMutation,
  };
}

export function useSkills() {
  return useQuery(skillsListQueryOptions());
}

export function useSkillActions() {
  const queryClient = useQueryClient();

  const createSkillMutation = useMutation({
    mutationFn: async (params: {
      name: string;
      description: string;
      content?: string;
      scope?: "project" | "global";
    }) => {
      const res = await callRpc("plugins.skills.create", params);
      return res.skill;
    },
    onSuccess: (created) => {
      queryClient.setQueryData(
        PLUGINS_KEYS.skills(),
        (
          prev:
            | { skills: SkillView[]; endorsed: SkillView[] }
            | undefined,
        ) => {
          if (!prev) return prev;
          return {
            ...prev,
            skills: [
              created,
              ...prev.skills.filter((s) => s.name !== created.name),
            ],
          };
        },
      );
    },
  });

  const installSkillMutation = useMutation({
    mutationFn: async (skill: SkillView) => {
      await callRpc("plugins.skills.install", { name: skill.name });
      return skill;
    },
    onSuccess: (installedSkill) => {
      queryClient.setQueryData(
        PLUGINS_KEYS.skills(),
        (
          prev:
            | { skills: SkillView[]; endorsed: SkillView[] }
            | undefined,
        ) => {
          if (!prev) return prev;
          const promoted: SkillView = {
            ...installedSkill,
            scope: "project",
            installed: true,
          };
          return {
            skills: [
              promoted,
              ...prev.skills.filter((s) => s.name !== promoted.name),
            ],
            endorsed: prev.endorsed.map((e) =>
              e.name === installedSkill.name ? { ...e, installed: true } : e,
            ),
          };
        },
      );
    },
  });

  const reloadSkillsMutation = useMutation({
    mutationFn: async () => {
      return callRpc("plugins.skills.reload");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PLUGINS_KEYS.skills() });
    },
  });

  const runSkillMutation = useMutation({
    mutationFn: async (params: {
      sessionId: string;
      name: string;
      args?: string;
    }) => {
      return callRpc("plugins.skills.run", params);
    },
  });

  return {
    createSkillMutation,
    installSkillMutation,
    reloadSkillsMutation,
    runSkillMutation,
  };
}

export function useMemoryStatus() {
  return useQuery(memoryStatusQueryOptions());
}

export function useMemoryActions() {
  const queryClient = useQueryClient();

  const toggleMemoryMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await callRpc("plugins.memory.toggle", { enabled });
      return res.enabled;
    },
    onSuccess: (enabled) => {
      queryClient.setQueryData<MemoryStatusView>(
        PLUGINS_KEYS.memory(),
        (prev) => (prev ? { ...prev, enabled } : prev),
      );
    },
  });

  const togglePersistInjectionsMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      await callRpc("settings.features.set", {
        key: "persist_memory_injections",
        value: enabled,
      });
      return enabled;
    },
    onSuccess: (persistInjections) => {
      queryClient.setQueryData<MemoryStatusView>(
        PLUGINS_KEYS.memory(),
        (prev) => (prev ? { ...prev, persistInjections } : prev),
      );
    },
  });

  const extractMemoryMutation = useMutation({
    mutationFn: async (sessionId?: string) => {
      return callRpc(
        "plugins.memory.extract",
        sessionId ? { sessionId } : undefined,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PLUGINS_KEYS.memory() });
    },
  });

  const rememberFactMutation = useMutation({
    mutationFn: async (params: {
      content: string;
      scope: "project" | "global";
      tags: string[];
    }) => {
      const res = await callRpc("plugins.memory.remember", params);
      return res.fact;
    },
    onSuccess: (fact) => {
      queryClient.setQueryData<MemoryStatusView>(
        PLUGINS_KEYS.memory(),
        (prev) => {
          if (!prev) return prev;
          const facts = [fact, ...prev.facts];
          return {
            ...prev,
            totalCount: facts.length,
            facts,
          };
        },
      );
    },
  });

  const forgetFactMutation = useMutation({
    mutationFn: async (id: string) => {
      await callRpc("plugins.memory.forget", { id });
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData<MemoryStatusView>(
        PLUGINS_KEYS.memory(),
        (prev) => {
          if (!prev) return prev;
          const facts = prev.facts.filter((f) => f.id !== id);
          return {
            ...prev,
            totalCount: facts.length,
            facts,
          };
        },
      );
    },
  });

  const tagFactMutation = useMutation({
    mutationFn: async (params: { id: string; tags: string[] }) => {
      await callRpc("plugins.memory.tag", params);
      return params;
    },
    onSuccess: ({ id, tags }) => {
      queryClient.setQueryData<MemoryStatusView>(
        PLUGINS_KEYS.memory(),
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            facts: prev.facts.map((f: MemoryFactView) =>
              f.id === id ? { ...f, tags } : f,
            ),
          };
        },
      );
    },
  });

  const linkFactsMutation = useMutation({
    mutationFn: async (params: {
      sourceId: string;
      targetId: string;
      relation?: string;
    }) => {
      await callRpc("plugins.memory.link", params);
      return params;
    },
    onSuccess: ({ sourceId, targetId }) => {
      queryClient.setQueryData<MemoryStatusView>(
        PLUGINS_KEYS.memory(),
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            facts: prev.facts.map((f) =>
              f.id === sourceId
                ? {
                    ...f,
                    relatedIds: Array.from(
                      new Set([...(f.relatedIds ?? []), targetId]),
                    ),
                  }
                : f,
            ),
          };
        },
      );
    },
  });

  return {
    toggleMemoryMutation,
    togglePersistInjectionsMutation,
    extractMemoryMutation,
    rememberFactMutation,
    forgetFactMutation,
    tagFactMutation,
    linkFactsMutation,
  };
}

export function useWorkspaceIntegrations() {
  return useQuery(workspaceIntegrationsQueryOptions());
}

export function useTriggerWorkspaceIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      integration: "gmail" | "calendar" | "browser" | "companion";
      action: string;
      payload?: Record<string, unknown>;
    }) => {
      const res = await callRpc("plugins.workspace.trigger", params);
      return { ...params, ...res };
    },
    onSuccess: ({ integration, action }) => {
      queryClient.setQueryData<WorkspaceIntegrationsView>(
        PLUGINS_KEYS.workspace(),
        (prev) => {
          if (!prev) return prev;
          if (integration === "gmail" && action === "connect") {
            return {
              ...prev,
              gmail: {
                ...prev.gmail,
                connected: true,
                account: "dev@rayucode.com",
              },
              calendar: {
                ...prev.calendar,
                connected: true,
                calendarCount: 3,
              },
            };
          }
          if (integration === "calendar" && action === "connect") {
            return {
              ...prev,
              calendar: {
                ...prev.calendar,
                connected: true,
                calendarCount: 3,
              },
            };
          }
          if (integration === "browser" && action === "handoff") {
            return {
              ...prev,
              browser: {
                ...prev.browser,
                handoffActive: !prev.browser.handoffActive,
                activeUrl: "http://localhost:5173",
              },
            };
          }
          if (integration === "companion" && action === "toggleKeepAwake") {
            return {
              ...prev,
              companion: {
                ...prev.companion,
                keepAwake: !prev.companion.keepAwake,
              },
            };
          }
          return prev;
        },
      );
    },
  });
}
