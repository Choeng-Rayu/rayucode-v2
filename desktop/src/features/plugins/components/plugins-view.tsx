import * as React from "react"
import {
  Box,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  Info,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ErrorState } from "@/components/ui/error-state"
import { PluginsSkeleton } from "@/components/ui/page-skeletons"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import {
  CUSTOMIZE_NAV_ITEMS,
  PLUGIN_CATEGORY_SECTIONS,
  filterPluginsByQuery,
} from "../constants/catalog"
import {
  usePluginsState,
  useSetFeaturedPlugin,
  useTogglePluginInstall,
  useToggleSkill,
} from "../hooks/use-plugins"
import { customizeTabSchema, pluginSearchInputSchema } from "../schemas"
import type { CustomizeTab, PluginCatalogItem } from "../types"
import { BrandLogo } from "./brand-logos"
import { FeaturedShowcase } from "./featured-showcase"

export interface PluginsViewProps {
  initialTab?: CustomizeTab
  className?: string
}

function CustomizeNavIcon({ tab }: { tab: CustomizeTab }) {
  switch (tab) {
    case "plugins":
      return <Plug className="size-4" />
    case "skills":
      return <Box className="size-4" />
    case "memory":
      return <Brain className="size-4" />
  }
}

export function PluginsView({
  initialTab = "plugins",
  className,
}: PluginsViewProps) {
  const setActiveRoute = useAppStore((s) => s.setActiveRoute)
  const [activeTab, setActiveTab] = React.useState<CustomizeTab>(initialTab)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [publicFilter, setPublicFilter] = React.useState<"public" | "installed">(
    "public"
  )
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const { data, isLoading, isError, error, refetch } = usePluginsState()
  const toggleInstallMutation = useTogglePluginInstall()
  const setFeaturedMutation = useSetFeaturedPlugin()
  const toggleSkillMutation = useToggleSkill()

  const handleTabChange = React.useCallback((value: string) => {
    const parsed = customizeTabSchema.safeParse(value)
    if (parsed.success) {
      setActiveTab(parsed.data)
    }
  }, [])

  const handleSearchChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value
      const parsed = pluginSearchInputSchema.safeParse({ query: next })
      if (parsed.success) {
        setSearchQuery(parsed.data.query)
      }
    },
    []
  )

  const handleFocusSearch = React.useCallback(() => {
    setActiveTab("plugins")
    requestAnimationFrame(() => {
      searchInputRef.current?.focus()
    })
  }, [])

  const handleConfigurePlugin = React.useCallback((plugin: PluginCatalogItem) => {
    toast(`${plugin.name} · MCP server & RayuCode skills ready`)
  }, [])

  const installedPlugins = React.useMemo(
    () => (data?.plugins ?? []).filter((plugin) => plugin.installed),
    [data]
  )

  const filteredPlugins = React.useMemo(() => {
    const base = data?.plugins ?? []
    const byScope =
      publicFilter === "installed" ? base.filter((p) => p.installed) : base
    return filterPluginsByQuery(byScope, searchQuery)
  }, [data, publicFilter, searchQuery])

  const pluginsByCategory = React.useMemo(() => {
    return PLUGIN_CATEGORY_SECTIONS.map((section) => ({
      ...section,
      items: filteredPlugins.filter((p) => p.category === section.id),
    })).filter((section) => section.items.length > 0)
  }, [filteredPlugins])

  if (isLoading && !data) {
    return <PluginsSkeleton />
  }

  if (isError || !data) {
    return (
      <div className="mx-auto flex w-full max-w-[960px] p-6">
        <ErrorState
          title="Failed to load Plugins & Customize registry"
          description={
            error instanceof Error
              ? error.message
              : "Could not reach the RayuCode plugin daemon."
          }
          onRetry={() => void refetch()}
        />
      </div>
    )
  }

  const isSearching = searchQuery.trim().length > 0
  const showShowcase = !isSearching && publicFilter === "public"

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      orientation="vertical"
      data-testid="plugins-view"
      className={cn(
        "flex h-full min-h-0 w-full flex-col gap-0 md:flex-row",
        className
      )}
    >
      {/* Left Customize Sub-Sidebar */}
      <aside
        aria-label="Customize sections"
        data-testid="customize-sidebar"
        className="flex w-full shrink-0 flex-col border-b border-hairline bg-chrome/60 px-3 py-4 select-none md:w-[228px] md:border-r md:border-b-0"
      >
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-[15px] font-semibold tracking-tight text-ink">
            Customize
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Focus plugin search"
                onClick={handleFocusSearch}
              >
                <Search className="size-3.5 text-muted-ink" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Search plugins</TooltipContent>
          </Tooltip>
        </div>

        <TabsList
          variant="line"
          className="h-auto w-full flex-row gap-1 bg-transparent p-0 md:flex-col md:items-stretch"
        >
          {CUSTOMIZE_NAV_ITEMS.map((item) => (
            <TabsTrigger
              key={item.id}
              value={item.id}
              data-testid={`customize-tab-${item.id}`}
              className="h-auto w-full justify-start gap-2.5 rounded-[9px] px-2.5 py-2 text-[13px] font-normal text-body data-[state=active]:border-transparent data-[state=active]:bg-active data-[state=active]:font-medium data-[state=active]:text-ink data-[state=active]:shadow-none"
            >
              <CustomizeNavIcon tab={item.id} />
              <span className="truncate">{item.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="mt-5 flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-2.5 pb-1.5">
            <span className="text-xs font-medium text-muted-ink">
              Installed
            </span>
            {installedPlugins.length > 0 && (
              <span
                data-testid="installed-plugins-count"
                className="rounded-full bg-active px-1.5 py-0.5 font-mono text-[10px] text-body tabular-nums"
              >
                {installedPlugins.length}
              </span>
            )}
          </div>

          {installedPlugins.length === 0 ? (
            <div
              data-testid="installed-plugins-empty"
              className="px-2.5 py-1 text-[13px] text-muted-ink"
            >
              No installed plugins
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <div
                data-testid="installed-plugins-list"
                className="flex flex-col gap-0.5 pr-1"
              >
                {installedPlugins.map((plugin) => (
                  <button
                    key={plugin.id}
                    type="button"
                    data-testid={`installed-plugin-${plugin.id}`}
                    title={`Click to disconnect ${plugin.name}`}
                    onClick={() => toggleInstallMutation.mutate(plugin)}
                    className="group flex w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 py-1.5 text-left text-[13px] text-ink transition-colors hover:bg-hover"
                  >
                    <BrandLogo name={plugin.id} size="sm" />
                    <span className="min-w-0 flex-1 truncate">
                      {plugin.name}
                    </span>
                    <span className="text-[11px] text-muted-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      Remove
                    </span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </aside>

      {/* Right Scrollable Main Directory */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-[960px] px-6 py-8 md:px-12 md:py-10">
          {/* PLUGINS VIEW */}
          <TabsContent value="plugins" className="m-0">
            <header className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight text-ink">
                  Plugins
                </h1>
                <p className="mt-1.5 text-[13px] text-muted-ink">
                  Connect plugins to let RayuCode work across your tools
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={publicFilter === "public"}
                    onClick={() => setPublicFilter("public")}
                    className={cn(
                      "inline-flex cursor-pointer items-center rounded-full border px-3.5 py-1 text-xs font-medium transition-colors",
                      publicFilter === "public"
                        ? "border-premium bg-active text-ink shadow-bevel-surface"
                        : "border-hairline bg-transparent text-muted-ink hover:bg-hover hover:text-ink"
                    )}
                  >
                    Public
                  </button>
                  <button
                    type="button"
                    aria-pressed={publicFilter === "installed"}
                    onClick={() => setPublicFilter("installed")}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-1 text-xs font-medium transition-colors",
                      publicFilter === "installed"
                        ? "border-premium bg-active text-ink shadow-bevel-surface"
                        : "border-hairline bg-transparent text-muted-ink hover:bg-hover hover:text-ink"
                    )}
                  >
                    <span>Installed</span>
                    <span className="font-mono text-[11px] text-muted-ink tabular-nums">
                      {installedPlugins.length}
                    </span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <label className="flex h-[34px] w-[248px] items-center gap-2 rounded-full border border-premium bg-raised/70 px-3.5 shadow-bevel-surface focus-within:border-premium-hi">
                  <Search className="size-3.5 shrink-0 text-muted-ink" />
                  <input
                    ref={searchInputRef}
                    id="plugin-search-input"
                    data-testid="plugin-search-input"
                    type="search"
                    value={searchQuery}
                    onChange={handleSearchChange}
                    placeholder="Search plugins"
                    aria-label="Search plugins"
                    className="w-full bg-transparent text-xs text-ink placeholder:text-muted-ink focus:outline-none"
                  />
                  {isSearching && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => setSearchQuery("")}
                      className="grid size-4 shrink-0 cursor-pointer place-items-center rounded-full text-muted-ink hover:bg-hover hover:text-ink"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </label>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Refresh plugins"
                      onClick={() => {
                        void refetch()
                        toast("Plugin registry synced")
                      }}
                    >
                      <RefreshCw className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Refresh registry</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Plugin settings"
                      onClick={() => setActiveRoute("settings")}
                    >
                      <Settings className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Plugin settings</TooltipContent>
                </Tooltip>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="default"
                      className="h-[34px] rounded-full px-4 font-semibold"
                    >
                      <span>Add</span>
                      <ChevronDown className="size-3 text-muted-ink" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Add Custom Integration</DropdownMenuLabel>
                    <DropdownMenuItem
                      onClick={() =>
                        toast("Opened MCP server config (~/.rayu/mcp.json)")
                      }
                    >
                      <Plug className="size-3.5" />
                      <span>Connect MCP server</span>
                      <span className="ml-auto font-mono text-[10px] text-muted-ink">
                        stdio / SSE
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => toast("Import local plugin manifest")}
                    >
                      <FolderOpen className="size-3.5" />
                      <span>Load local plugin</span>
                      <span className="ml-auto font-mono text-[10px] text-muted-ink">
                        manifest.json
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setActiveRoute("settings")}
                    >
                      <Settings className="size-3.5" />
                      <span>Manage connectors</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>

            {showShowcase && (
              <FeaturedShowcase
                featuredId={data.featuredId}
                plugins={data.plugins}
                onSelectFeatured={(pluginId) =>
                  setFeaturedMutation.mutate(pluginId)
                }
                onToggleInstall={(plugin) =>
                  toggleInstallMutation.mutate(plugin)
                }
                onConfigure={handleConfigurePlugin}
                isPending={toggleInstallMutation.isPending}
              />
            )}

            {isSearching && (
              <div className="mt-5 flex items-center justify-between text-xs text-muted-ink">
                <span>
                  Showing {filteredPlugins.length}{" "}
                  {filteredPlugins.length === 1 ? "plugin" : "plugins"} matching
                  &ldquo;{searchQuery.trim()}&rdquo;
                </span>
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="cursor-pointer font-medium text-brand-text hover:underline"
                >
                  Clear filter
                </button>
              </div>
            )}

            {pluginsByCategory.length === 0 ? (
              <div
                data-testid="plugins-empty-state"
                className="mt-8 flex flex-col items-center justify-center rounded-2xl border border-hairline bg-pane px-6 py-12 text-center"
              >
                <Plug className="size-6 text-muted-ink" />
                <p className="mt-3 text-sm font-medium text-ink">
                  {publicFilter === "installed" && !isSearching
                    ? "No plugins installed yet"
                    : "No matching plugins found"}
                </p>
                <p className="mt-1 text-xs text-muted-ink">
                  {publicFilter === "installed" && !isSearching
                    ? "Browse the Public directory to connect GitHub, Linear, Context7 Docs, and more."
                    : "Try searching by connector name, workflow, or category."}
                </p>
                {(isSearching || publicFilter === "installed") && (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="mt-4 rounded-full"
                    onClick={() => {
                      setSearchQuery("")
                      setPublicFilter("public")
                    }}
                  >
                    Show all public plugins
                  </Button>
                )}
              </div>
            ) : (
              pluginsByCategory.map((section) => (
                <section
                  key={section.id}
                  data-testid={`plugins-section-${section.id}`}
                  className="mt-8"
                >
                  <h2 className="mb-4 inline-flex items-center gap-1 text-[13px] font-semibold tracking-tight text-ink">
                    <span>{section.label}</span>
                    <ChevronRight className="size-3.5 text-muted-ink" />
                  </h2>

                  <div className="grid grid-cols-1 gap-x-11 gap-y-5 md:grid-cols-2">
                    {section.items.map((plugin) => (
                      <div
                        key={plugin.id}
                        data-testid={`plugin-card-${plugin.id}`}
                        className="flex min-w-0 items-center gap-3.5 py-1"
                      >
                        <BrandLogo name={plugin.id} size="md" />

                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium text-ink">
                            {plugin.name}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-muted-ink">
                            {plugin.description}
                          </div>
                        </div>

                        {plugin.infoOnly ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`${plugin.name} info`}
                                data-testid={`plugin-info-${plugin.id}`}
                                onClick={() =>
                                  toggleInstallMutation.mutate(plugin)
                                }
                              >
                                <Info className="size-4 text-muted-ink" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left">
                              Requires macOS permission
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Button
                            type="button"
                            variant={plugin.installed ? "secondary" : "outline"}
                            size="sm"
                            data-testid={`plugin-toggle-${plugin.id}`}
                            aria-pressed={plugin.installed}
                            aria-label={
                              plugin.installed
                                ? `Installed ${plugin.name}`
                                : `Install ${plugin.name}`
                            }
                            onClick={() => toggleInstallMutation.mutate(plugin)}
                            className={cn(
                              "h-7 shrink-0 rounded-full px-3 text-xs",
                              plugin.installed
                                ? "border-brand/40 bg-brand-soft text-brand-text hover:border-brand/60 hover:bg-brand-soft"
                                : "border-hairline text-body hover:border-premium-hi hover:text-ink"
                            )}
                          >
                            {plugin.installed ? (
                              <>
                                <Check className="size-3" />
                                <span>Installed</span>
                              </>
                            ) : (
                              <>
                                <Plus className="size-3" />
                                <span>Install</span>
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))
            )}
          </TabsContent>

          {/* SKILLS VIEW */}
          <TabsContent value="skills" data-testid="skills-view" className="m-0">
            <header className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight text-ink">
                  Skills
                </h1>
                <p className="mt-1.5 text-[13px] text-muted-ink">
                  Reusable workflows loaded from{" "}
                  <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-xs text-body">
                    ~/.rayu/skills
                  </code>{" "}
                  and project{" "}
                  <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-xs text-body">
                    .agents/skills
                  </code>
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-premium bg-active px-3.5 py-1 text-xs font-medium text-ink shadow-bevel-surface">
                    Workspace
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-0.5">
                <Button
                  type="button"
                  variant="default"
                  className="h-[34px] rounded-full px-4 font-semibold"
                  onClick={() =>
                    toast("Created new skill template in .agents/skills/")
                  }
                >
                  <Plus className="size-3.5" />
                  <span>New skill</span>
                </Button>
              </div>
            </header>

            <section className="mt-8">
              <h2 className="mb-4 inline-flex items-center gap-1 text-[13px] font-semibold tracking-tight text-ink">
                <span>Loaded Skills</span>
                <ChevronRight className="size-3.5 text-muted-ink" />
              </h2>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {data.skills.map((skill) => (
                  <div
                    key={skill.id}
                    data-testid={`skill-card-${skill.id}`}
                    className="rayu-card-bevel flex items-start gap-3.5 rounded-xl bg-pane p-4"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-[10px] border border-premium",
                        skill.enabled
                          ? "bg-brand-soft text-brand-text"
                          : "bg-inset text-muted-ink"
                      )}
                    >
                      <Sparkles className="size-4" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-ink">
                          {skill.name}
                        </span>
                        <span
                          data-testid={`skill-tokens-${skill.id}`}
                          className="rounded-full border border-hairline bg-inset px-2 py-0.5 font-mono text-[11px] text-body tabular-nums"
                        >
                          {skill.tokens} tok
                        </span>
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-muted-ink">
                        {skill.scope}
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-muted-ink">
                        {skill.description}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                      <Switch
                        checked={skill.enabled}
                        data-testid={`skill-switch-${skill.id}`}
                        aria-label={`Toggle ${skill.name}`}
                        onCheckedChange={() =>
                          toggleSkillMutation.mutate(skill.id)
                        }
                      />
                      <span
                        className={cn(
                          "text-[10.5px] font-medium",
                          skill.enabled ? "text-brand-text" : "text-muted-ink"
                        )}
                      >
                        {skill.enabled ? "Active" : "Paused"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </TabsContent>

          {/* MEMORY VIEW */}
          <TabsContent value="memory" data-testid="memory-view" className="m-0">
            <header className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight text-ink">
                  Memory &amp; Cache
                </h1>
                <p className="mt-1.5 text-[13px] text-muted-ink">
                  Durable session learnings (
                  <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-xs text-body">
                    CLAUDE.md
                  </code>{" "}
                  /{" "}
                  <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-xs text-body">
                    AGENTS.md
                  </code>{" "}
                  /{" "}
                  <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-xs text-body">
                    GEMINI.md
                  </code>
                  ) and warm KV prompt cache
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-premium bg-active px-3.5 py-1 text-xs font-medium text-ink shadow-bevel-surface">
                    rayucode-v2
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="rounded-full"
                  onClick={() =>
                    toast("Extracted durable learnings from active session")
                  }
                >
                  Extract memory
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="rounded-full"
                  onClick={() =>
                    toast("KV prompt cache refreshed · 94% hit rate (1h TTL)")
                  }
                >
                  Refresh KV cache
                </Button>
              </div>
            </header>

            <section className="mt-8">
              <h2 className="mb-4 inline-flex items-center gap-1 text-[13px] font-semibold tracking-tight text-ink">
                <span>Memory Files</span>
                <ChevronRight className="size-3.5 text-muted-ink" />
              </h2>

              <div className="flex flex-col gap-3.5">
                {data.memories.map((memory) => (
                  <article
                    key={memory.id}
                    data-testid={`memory-card-${memory.id}`}
                    className="rayu-card-bevel rounded-xl bg-pane p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="grid size-8 shrink-0 place-items-center rounded-lg border border-hairline bg-info-soft text-info"
                      >
                        <FileText className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-ink">
                        {memory.path}
                      </span>
                      <span className="rounded-full border border-hairline bg-inset px-2 py-0.5 font-mono text-[11px] text-body tabular-nums">
                        {memory.tokens}
                      </span>
                      <span className="text-xs text-muted-ink">
                        {memory.updatedAt}
                      </span>
                      <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-text">
                        Loaded
                      </span>
                    </div>

                    <pre className="mt-3 overflow-x-auto rounded-lg border border-hairline bg-inset px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-body">
                      {memory.preview}
                    </pre>
                  </article>
                ))}
              </div>
            </section>

            <section className="mt-8">
              <h2 className="mb-4 inline-flex items-center gap-1 text-[13px] font-semibold tracking-tight text-ink">
                <span>Prompt KV Cache</span>
                <ChevronRight className="size-3.5 text-muted-ink" />
              </h2>

              <div className="rayu-card-bevel max-w-[460px] rounded-xl bg-pane p-4 text-xs">
                <div className="flex items-center justify-between py-1 text-body">
                  <span>Status</span>
                  <span className="font-mono font-medium text-brand-text">
                    Warm · 1h TTL
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 text-body">
                  <span>Cache hit ratio</span>
                  <span className="font-mono text-ink tabular-nums">94%</span>
                </div>
                <div className="flex items-center justify-between py-1 text-body">
                  <span>Cached prefix</span>
                  <span className="font-mono text-ink tabular-nums">
                    24.8K tokens
                  </span>
                </div>
                <div className="mt-2 border-t border-dashed border-hairline-strong pt-2 text-xs font-semibold text-brand-text">
                  Synced across rayu CLI &amp; Desktop via ~/.rayu/
                </div>
              </div>
            </section>
          </TabsContent>
        </div>
      </ScrollArea>
    </Tabs>
  )
}
