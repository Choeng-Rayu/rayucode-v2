import "@testing-library/jest-dom/vitest"
import { QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { useAppStore } from "@/lib/app-store"
import { ipcClient, type PluginsState } from "@/lib/ipc-client"
import { createQueryClient } from "@/lib/query-client"

import {
  BrandLogo,
  OFFICIAL_CONNECTOR_NAMES,
  PluginsView,
} from "../index"

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver =
      ResizeObserverStub as unknown as typeof ResizeObserver
  }
})

function createInitialMockPluginsState(): PluginsState {
  return {
    featuredId: "Dynatrace",
    plugins: [
      {
        id: "Firebase",
        name: "Firebase",
        description: "Firestore, Auth, Functions & preview channels",
        heroDescription:
          "Inspect Firestore collections, Auth users, Cloud Functions logs, and deploy preview channels directly from RayuCode via MCP.",
        category: "featured",
        installed: false,
        searchKeywords: "firebase firestore google cloud functions auth featured",
      },
      {
        id: "Supabase",
        name: "Supabase",
        description: "Postgres, RLS policies, migrations & Edge logs",
        heroDescription:
          "Query Postgres tables, inspect RLS policies, run migrations, and tail Edge Function logs straight from your RayuCode workspace.",
        category: "featured",
        installed: false,
        searchKeywords: "supabase postgres database rls edge functions featured",
      },
      {
        id: "Dynatrace",
        name: "Dynatrace",
        description: "Production problems, root causes, traces & logs",
        heroDescription:
          "Investigate production issues with real Dynatrace data: problems and root causes, logs, metrics, traces, and vulnerabilities, via skills and the MCP...",
        category: "featured",
        installed: false,
        searchKeywords: "dynatrace observability logs metrics traces apm featured",
      },
      {
        id: "Notion",
        name: "Notion",
        description: "Team wikis, RFC specs & sprint databases",
        heroDescription:
          "Search team wikis, sync RFC specs into Markdown previews, and update sprint databases automatically as RayuCode ships PRs.",
        category: "featured",
        installed: false,
        searchKeywords: "notion docs wiki database specs featured",
      },
      {
        id: "Linear",
        name: "Linear",
        description: "Triage cycles, pull issue context & link PRs",
        heroDescription:
          "Triage cycles, pull issue context directly into your prompt, and auto-link RayuCode Swarm branches and pull requests.",
        category: "featured",
        installed: false,
        searchKeywords: "linear issues cycles project tracking featured",
      },
      {
        id: "GitHub",
        name: "GitHub",
        description: "Triage PRs, issues, CI, and publish flows",
        category: "popular",
        installed: false,
        searchKeywords: "github git pr issues ci popular",
      },
      {
        id: "Context7 Docs",
        name: "Context7 Docs",
        description: "Up-to-date library docs & API snippets",
        category: "popular",
        installed: false,
        searchKeywords: "context7 docs documentation api react nextjs popular",
      },
      {
        id: "Google Drive",
        name: "Google Drive",
        description: "Drive, Docs, Sheets or Slides",
        category: "popular",
        installed: false,
        searchKeywords: "google drive docs sheets slides popular",
      },
      {
        id: "Health",
        name: "Health",
        description: "Explore your health data",
        category: "popular",
        installed: false,
        infoOnly: true,
        infoToast: "Health requires macOS Apple Health permission",
        searchKeywords: "health apple fitness wellness popular",
      },
      {
        id: "Sentry",
        name: "Sentry",
        description: "Trace production errors & stack frames",
        category: "noteworthy",
        installed: false,
        searchKeywords: "sentry errors crashes traces apm noteworthy",
      },
      {
        id: "Stripe",
        name: "Stripe",
        description: "Accept payments, grow revenue.",
        heroDescription:
          "Inspect payment intents, test webhooks locally, and scaffold billing & checkout flows with real Stripe API schemas.",
        category: "business",
        installed: false,
        searchKeywords: "stripe payments billing revenue small business featured",
      },
    ],
    skills: [
      {
        id: "sk_subagent",
        name: "superpowers:subagent-driven-development",
        scope: "~/.rayu/skills/subagent-driven-development",
        tokens: "4.2K",
        description:
          "Dispatch fresh subagents per task with two-stage spec & quality review",
        enabled: true,
      },
      {
        id: "sk_swarm",
        name: "rayu:swarm-coordinator",
        scope: "~/.rayu/skills/swarm-coordinator",
        tokens: "2.8K",
        description:
          "Orchestrate parallel swarm workers with scoped worktrees and verification gates",
        enabled: true,
      },
    ],
    memories: [
      {
        id: "mem_agents",
        path: "AGENTS.md",
        tokens: "312 tok",
        updatedAt: "8m ago",
        preview:
          "Single-source Tailwind v4 tokens in desktop/src/styles/globals.css; zero raw hex colors in TSX.",
      },
      {
        id: "mem_design",
        path: "DESIGN.md",
        tokens: "248 tok",
        updatedAt: "24m ago",
        preview:
          "Warm Graphite Dark (#11110E / #0C0C0A) and Warm Paper Light with Rayu Green or Ocean Blue accents.",
      },
      {
        id: "mem_claude",
        path: "CLAUDE.md",
        tokens: "158 tok",
        updatedAt: "1h ago",
        preview:
          "Shared Rust engine in crates/; run cd desktop && pnpm verify before reporting done.",
      },
    ],
  }
}

function renderPluginsView() {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <PluginsView />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

function clickRadixTab(tab: HTMLElement) {
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false })
  fireEvent.click(tab)
}

describe("PluginsView", () => {
  let stateRef: PluginsState

  beforeEach(() => {
    stateRef = createInitialMockPluginsState()
    useAppStore.getState().setActiveRoute("plugins")

    vi.spyOn(ipcClient.plugins, "getState").mockImplementation(async () =>
      structuredClone(stateRef)
    )

    vi.spyOn(ipcClient.plugins, "toggleInstall").mockImplementation(
      async (pluginId: string) => {
        stateRef = {
          ...stateRef,
          plugins: stateRef.plugins.map((p) =>
            p.id === pluginId && !p.infoOnly
              ? { ...p, installed: !p.installed }
              : p
          ),
        }
        return structuredClone(stateRef)
      }
    )

    vi.spyOn(ipcClient.plugins, "setFeatured").mockImplementation(
      async (pluginId: string) => {
        stateRef = {
          ...stateRef,
          featuredId: pluginId,
        }
        return structuredClone(stateRef)
      }
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("filters plugins live by name, description, and searchKeywords", async () => {
    renderPluginsView()

    await screen.findByTestId("plugins-view")

    expect(screen.getByTestId("plugin-card-GitHub")).toBeInTheDocument()
    expect(screen.getByTestId("plugin-card-Stripe")).toBeInTheDocument()
    expect(screen.getByTestId("featured-showcase")).toBeInTheDocument()

    const searchInput = screen.getByTestId("plugin-search-input")

    // Filter by keyword ("documentation" matches Context7 Docs searchKeywords)
    fireEvent.change(searchInput, { target: { value: "documentation" } })

    expect(screen.getByTestId("plugin-card-Context7 Docs")).toBeInTheDocument()
    expect(screen.queryByTestId("plugin-card-GitHub")).not.toBeInTheDocument()
    expect(screen.queryByTestId("plugin-card-Stripe")).not.toBeInTheDocument()

    // Filter by name ("Linear")
    fireEvent.change(searchInput, { target: { value: "Linear" } })
    expect(screen.getByTestId("plugin-card-Linear")).toBeInTheDocument()
    expect(
      screen.queryByTestId("plugin-card-Context7 Docs")
    ).not.toBeInTheDocument()

    // Non-matching query displays empty state and Clear filter restores directory
    fireEvent.change(searchInput, { target: { value: "nonexistent-mcp" } })
    expect(screen.getByTestId("plugins-empty-state")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }))
    expect(screen.getByTestId("plugin-card-GitHub")).toBeInTheDocument()
    expect(screen.getByTestId("featured-showcase")).toBeInTheDocument()
  })

  it("switches the FeaturedShowcase spotlight banner when clicking a featured tile", async () => {
    renderPluginsView()

    await screen.findByTestId("featured-showcase")

    expect(screen.getByTestId("featured-spotlight-title")).toHaveTextContent(
      "Dynatrace"
    )

    const linearTile = screen.getByTestId("featured-tile-Linear")
    fireEvent.click(linearTile)

    await waitFor(() => {
      expect(ipcClient.plugins.setFeatured).toHaveBeenCalledWith("Linear")
      expect(screen.getByTestId("featured-spotlight-title")).toHaveTextContent(
        "Linear"
      )
      expect(screen.getByTestId("featured-spotlight-desc")).toHaveTextContent(
        "Triage cycles, pull issue context directly into your prompt"
      )
    })

    expect(screen.getByTestId("featured-tile-Linear")).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    expect(screen.getByTestId("featured-tile-Dynatrace")).toHaveAttribute(
      "aria-pressed",
      "false"
    )
  })

  it("syncs Install / Installed button clicks with the left Installed sidebar list", async () => {
    renderPluginsView()

    await screen.findByTestId("plugins-view")

    expect(screen.getByTestId("installed-plugins-empty")).toBeInTheDocument()

    // Install GitHub from directory card
    const githubToggle = screen.getByTestId("plugin-toggle-GitHub")
    expect(githubToggle).toHaveTextContent("Install")
    fireEvent.click(githubToggle)

    await waitFor(() => {
      expect(ipcClient.plugins.toggleInstall).toHaveBeenCalledWith("GitHub")
      expect(screen.getByTestId("plugin-toggle-GitHub")).toHaveTextContent(
        "Installed"
      )
      expect(screen.getByTestId("installed-plugins-list")).toBeInTheDocument()
      expect(
        screen.getByTestId("installed-plugin-GitHub")
      ).toBeInTheDocument()
    })

    // Install Linear from directory card as well
    fireEvent.click(screen.getByTestId("plugin-toggle-Linear"))

    await waitFor(() => {
      const installedList = screen.getByTestId("installed-plugins-list")
      expect(within(installedList).getByText("GitHub")).toBeInTheDocument()
      expect(within(installedList).getByText("Linear")).toBeInTheDocument()
      expect(screen.getByTestId("installed-plugins-count")).toHaveTextContent(
        "2"
      )
    })

    // Remove GitHub directly from the left Installed sidebar
    fireEvent.click(screen.getByTestId("installed-plugin-GitHub"))

    await waitFor(() => {
      expect(
        screen.queryByTestId("installed-plugin-GitHub")
      ).not.toBeInTheDocument()
      expect(screen.getByTestId("plugin-toggle-GitHub")).toHaveTextContent(
        "Install"
      )
      expect(screen.getByTestId("installed-plugins-count")).toHaveTextContent(
        "1"
      )
    })
  })

  it("switches between Plugins, Skills (with Switch toggle), and Memory views", async () => {
    renderPluginsView()

    await screen.findByTestId("plugins-view")

    // Switch to Skills tab
    const skillsTab = screen.getByTestId("customize-tab-skills")
    clickRadixTab(skillsTab)

    const skillsView = await screen.findByTestId("skills-view")
    expect(
      within(skillsView).getByText("superpowers:subagent-driven-development")
    ).toBeInTheDocument()
    expect(
      within(skillsView).getByText("rayu:swarm-coordinator")
    ).toBeInTheDocument()
    expect(screen.getByTestId("skill-tokens-sk_subagent")).toHaveTextContent(
      "4.2K tok"
    )

    // Toggle skill Switch
    const skillSwitch = screen.getByTestId("skill-switch-sk_subagent")
    expect(skillSwitch).toHaveAttribute("data-state", "checked")
    fireEvent.click(skillSwitch)

    await waitFor(() => {
      expect(
        screen.getByTestId("skill-switch-sk_subagent")
      ).toHaveAttribute("data-state", "unchecked")
    })

    // Switch to Memory tab
    const memoryTab = screen.getByTestId("customize-tab-memory")
    clickRadixTab(memoryTab)

    const memoryView = await screen.findByTestId("memory-view")
    const agentsCard = within(memoryView).getByTestId("memory-card-mem_agents")
    const designCard = within(memoryView).getByTestId("memory-card-mem_design")
    const claudeCard = within(memoryView).getByTestId("memory-card-mem_claude")
    expect(within(agentsCard).getByText("AGENTS.md")).toBeInTheDocument()
    expect(within(designCard).getByText("DESIGN.md")).toBeInTheDocument()
    expect(within(claudeCard).getByText("CLAUDE.md")).toBeInTheDocument()
    expect(within(agentsCard).getByText("312 tok")).toBeInTheDocument()
    expect(within(agentsCard).getByText("8m ago")).toBeInTheDocument()
    expect(
      within(agentsCard).getByText(/Single-source Tailwind v4 tokens/)
    ).toBeInTheDocument()
  })

  it("renders crisp SVG brand logos for all 16 official connectors", () => {
    const { container } = render(
      <div>
        {OFFICIAL_CONNECTOR_NAMES.map((name) => (
          <BrandLogo key={name} name={name} />
        ))}
      </div>
    )

    const svgs = container.querySelectorAll("svg")
    expect(svgs).toHaveLength(16)
    for (const name of OFFICIAL_CONNECTOR_NAMES) {
      const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
      expect(
        container.querySelector(`[data-brand-logo="${normalized}"] svg`)
      ).not.toBeNull()
    }
  })
})
