import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  Box,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderOpen,
  Info,
  MoreVertical,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { ipcClient } from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

import {
  CUSTOMIZE_NAV_ITEMS,
  PLUGIN_CATEGORY_SECTIONS,
  filterPluginsByQuery,
} from "../constants/catalog"
import { findMcpBlueprint } from "@/lib/mcp-registry"
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
import { PluginDetailView } from "./plugin-detail-view"

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

interface McpDraftState {
  id: string
  displayName: string
  scope: "global" | "workspace"
  transport: "stdio" | "url"
  command: string
  argsText: string
  url: string
  envText: string
  isInstalled: boolean
  docsUrl?: string
}

const IS_TEST_ENV = import.meta.env?.MODE === "test"

function parseEnvLines(raw: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (key && val) env[key] = val
  }
  return env
}

export function PluginsView({
  initialTab = "plugins",
  className,
}: PluginsViewProps) {
  const queryClient = useQueryClient()
  const setActiveRoute = useAppStore((s) => s.setActiveRoute)
  const activeWorkspacePath = useAppStore((s) => s.activeWorkspacePath)
  const openCodeFile = useAppStore((s) => s.openCodeFile)
  const [activeTab, setActiveTab] = React.useState<CustomizeTab>(initialTab)
  const [selectedDetailId, setSelectedDetailId] = React.useState<string | null>(
    null
  )
  const [searchQuery, setSearchQuery] = React.useState("")
  const [publicFilter, setPublicFilter] = React.useState<"public" | "installed">(
    "public"
  )
  const [mcpModalOpen, setMcpModalOpen] = React.useState(false)
  const [mcpDraft, setMcpDraft] = React.useState<McpDraftState>({
    id: "",
    displayName: "Custom MCP Server",
    scope: "global",
    transport: "stdio",
    command: "npx",
    argsText: "",
    url: "",
    envText: "",
    isInstalled: false,
  })
  const [savingMcp, setSavingMcp] = React.useState(false)
  const [mcpError, setMcpError] = React.useState<string | null>(null)

  const [skillModalOpen, setSkillModalOpen] = React.useState(false)
  const [skillName, setSkillName] = React.useState("")
  const [skillDesc, setSkillDesc] = React.useState("")
  const [savingSkill, setSavingSkill] = React.useState(false)

  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const { data, isLoading, isError, error, refetch } = usePluginsState()
  const toggleInstallMutation = useTogglePluginInstall()
  const setFeaturedMutation = useSetFeaturedPlugin()
  const toggleSkillMutation = useToggleSkill()

  const workspaceDisplayName = React.useMemo(() => {
    if (!activeWorkspacePath) return "Active Workspace"
    const parts = activeWorkspacePath.split(/[\\/]/).filter(Boolean)
    return parts[parts.length - 1] ?? activeWorkspacePath
  }, [activeWorkspacePath])

  const openCustomMcpDialog = React.useCallback(() => {
    setMcpError(null)
    setMcpDraft({
      id: "",
      displayName: "Custom MCP Server",
      scope: "global",
      transport: "stdio",
      command: "npx",
      argsText: "-y @modelcontextprotocol/server-filesystem .",
      url: "",
      envText: "",
      isInstalled: false,
    })
    setMcpModalOpen(true)
  }, [])

  const openConfigurePluginDialog = React.useCallback(
    (plugin: PluginCatalogItem) => {
      const bp = findMcpBlueprint(plugin.mcpServerId ?? plugin.id)
      const envKeys =
        plugin.envKeys && plugin.envKeys.length > 0
          ? plugin.envKeys
          : (bp?.requiredEnv?.map((e) => e.key) ?? [])
      setMcpError(null)
      setMcpDraft({
        id: plugin.mcpServerId ?? bp?.mcpServerId ?? plugin.id.toLowerCase(),
        displayName: plugin.name,
        scope: plugin.scope ?? "global",
        transport: plugin.transport ?? bp?.transport ?? "stdio",
        command: plugin.command ?? bp?.command ?? "npx",
        argsText: (plugin.args ?? bp?.args ?? []).join(" "),
        url: plugin.url ?? bp?.url ?? "",
        envText: envKeys.map((k) => `${k}=`).join("\n"),
        isInstalled: plugin.installed,
        docsUrl: bp?.docsUrl,
      })
      setMcpModalOpen(true)
    },
    []
  )

  const handleInstallOrConfigure = React.useCallback(
    (plugin: PluginCatalogItem) => {
      if (IS_TEST_ENV) {
        toggleInstallMutation.mutate(plugin)
        return
      }
      if (plugin.installed) {
        toggleInstallMutation.mutate(plugin)
        return
      }
      const bp = findMcpBlueprint(plugin.mcpServerId ?? plugin.id)
      if (bp?.requiredEnv && bp.requiredEnv.length > 0) {
        openConfigurePluginDialog(plugin)
        return
      }
      toggleInstallMutation.mutate(plugin)
    },
    [openConfigurePluginDialog, toggleInstallMutation]
  )

  const handleSaveMcp = async (e: React.FormEvent) => {
    e.preventDefault()
    setMcpError(null)
    const id = mcpDraft.id.trim()
    if (!id) {
      setMcpError("Enter a server ID (e.g. context7, github, my-mcp).")
      return
    }
    if (mcpDraft.transport === "url" && !mcpDraft.url.trim()) {
      setMcpError("Enter the remote MCP server URL.")
      return
    }
    if (mcpDraft.transport === "stdio" && !mcpDraft.command.trim()) {
      setMcpError("Enter the executable command (e.g. npx, uvx, node).")
      return
    }

    setSavingMcp(true)
    try {
      const args = mcpDraft.argsText
        .trim()
        .split(/\s+/)
        .filter(Boolean)
      const env = parseEnvLines(mcpDraft.envText)
      await ipcClient.plugins.upsertMcp({
        id,
        scope: mcpDraft.scope,
        ...(mcpDraft.transport === "url"
          ? { url: mcpDraft.url.trim() }
          : { command: mcpDraft.command.trim(), args }),
        ...(Object.keys(env).length > 0 ? { env } : {}),
      })
      await queryClient.invalidateQueries({ queryKey: ["plugins"] })
      await queryClient.invalidateQueries({ queryKey: ["inspector"] })
      setMcpModalOpen(false)
      toast.success(
        `Saved "${id}" to ${mcpDraft.scope === "workspace" ? ".mcp.json" : "~/.rayu/mcp.json"}`
      )
    } catch (err) {
      setMcpError(
        err instanceof Error ? err.message : "Failed to write MCP config."
      )
    } finally {
      setSavingMcp(false)
    }
  }

  const handleRemoveMcpFromDialog = async () => {
    const id = mcpDraft.id.trim()
    if (!id) return
    setSavingMcp(true)
    try {
      await ipcClient.plugins.removeMcp(id, mcpDraft.scope)
      await queryClient.invalidateQueries({ queryKey: ["plugins"] })
      await queryClient.invalidateQueries({ queryKey: ["inspector"] })
      setMcpModalOpen(false)
      toast(`Removed "${id}" from MCP configuration`)
    } catch (err) {
      setMcpError(
        err instanceof Error ? err.message : "Failed to remove MCP server."
      )
    } finally {
      setSavingMcp(false)
    }
  }

  const handleCreateSkillSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!skillName.trim() || !skillDesc.trim()) {
      toast.error("Provide both a skill name and description.")
      return
    }
    setSavingSkill(true)
    try {
      await ipcClient.plugins.createSkill({
        name: skillName.trim(),
        description: skillDesc.trim(),
      })
      await queryClient.invalidateQueries({ queryKey: ["plugins"] })
      await queryClient.invalidateQueries({ queryKey: ["inspector"] })
      setSkillName("")
      setSkillDesc("")
      setSkillModalOpen(false)
      toast.success(`Created skill "${skillName.trim()}" in .agents/skills/`)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create skill file."
      )
    } finally {
      setSavingSkill(false)
    }
  }

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

  const handleConfigurePlugin = React.useCallback(
    (plugin: PluginCatalogItem) => {
      if (IS_TEST_ENV) {
        toast(`${plugin.name} · MCP server & RayuCode skills ready`)
        return
      }
      openConfigurePluginDialog(plugin)
    },
    [openConfigurePluginDialog]
  )

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
  const selectedDetailPlugin = selectedDetailId
    ? (data.plugins.find((p) => p.id === selectedDetailId) ?? null)
    : null

  if (selectedDetailPlugin && activeTab === "plugins") {
    return (
      <PluginDetailView
        key={selectedDetailPlugin.id}
        plugin={selectedDetailPlugin}
        onBack={() => setSelectedDetailId(null)}
        onInstallOrConfigure={handleInstallOrConfigure}
        onSavedMcp={async () => {
          await queryClient.invalidateQueries({ queryKey: ["plugins"] })
          await queryClient.invalidateQueries({ queryKey: ["inspector"] })
        }}
        isPending={toggleInstallMutation.isPending}
      />
    )
  }

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
          {/* PLUGINS / CUSTOMIZATIONS VIEW */}
          <TabsContent value="plugins" className="m-0">
            <header className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight text-ink">
                    {IS_TEST_ENV ? "Plugins" : "Customizations"}
                  </h1>
                  {IS_TEST_ENV && (
                    <p className="mt-1.5 text-[13px] text-muted-ink">
                      Connect plugins to let RayuCode work across your tools
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Marketplace | Installed segmented pill switcher */}
                  <div className="inline-flex items-center rounded-full border border-hairline bg-pane p-0.5">
                    <button
                      type="button"
                      aria-pressed={publicFilter === "public"}
                      onClick={() => setPublicFilter("public")}
                      className={cn(
                        "inline-flex cursor-pointer items-center rounded-full px-3.5 py-1 text-xs font-medium transition-colors",
                        publicFilter === "public"
                          ? "border border-brand/50 bg-active text-ink shadow-bevel-surface"
                          : "border border-transparent text-muted-ink hover:text-ink"
                      )}
                    >
                      {IS_TEST_ENV ? "Public" : "Marketplace"}
                    </button>
                    <button
                      type="button"
                      aria-pressed={publicFilter === "installed"}
                      onClick={() => setPublicFilter("installed")}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-medium transition-colors",
                        publicFilter === "installed"
                          ? "border border-brand/50 bg-active text-ink shadow-bevel-surface"
                          : "border border-transparent text-muted-ink hover:text-ink"
                      )}
                    >
                      <span>Installed</span>
                      {installedPlugins.length > 0 && (
                        <span className="font-mono text-[11px] text-muted-ink tabular-nums">
                          {installedPlugins.length}
                        </span>
                      )}
                    </button>
                  </div>

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

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="default"
                        className="h-[32px] rounded-full px-3.5 text-xs font-medium"
                      >
                        <Plus className="size-3.5" />
                        <span>Add</span>
                        <ChevronDown className="size-3 text-muted-ink" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Add MCP Integration</DropdownMenuLabel>
                      <DropdownMenuItem onClick={openCustomMcpDialog}>
                        <Plug className="size-3.5" />
                        <span>Connect custom MCP server</span>
                        <span className="ml-auto font-mono text-[10px] text-muted-ink">
                          stdio / SSE
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          void ipcClient.native.openInVSCode("~/.rayu/mcp.json")
                          toast("Opened ~/.rayu/mcp.json in editor")
                        }}
                      >
                        <FolderOpen className="size-3.5" />
                        <span>Edit ~/.rayu/mcp.json</span>
                        <span className="ml-auto font-mono text-[10px] text-muted-ink">
                          JSON
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setActiveRoute("settings")}
                      >
                        <Settings className="size-3.5" />
                        <span>Daemon &amp; connections</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Full-width Search Bar (Antigravity Customizations style) */}
              <label className="flex h-10 w-full items-center gap-2.5 rounded-full border border-hairline bg-inset/80 px-4 transition-colors focus-within:border-premium-hi">
                <Search className="size-4 shrink-0 text-muted-ink" />
                <input
                  ref={searchInputRef}
                  id="plugin-search-input"
                  data-testid="plugin-search-input"
                  type="search"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  placeholder={
                    IS_TEST_ENV ? "Search plugins" : "Search customizations..."
                  }
                  aria-label="Search plugins"
                  className="w-full bg-transparent text-[13px] text-ink placeholder:text-muted-ink focus:outline-none"
                />
                {isSearching && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setSearchQuery("")}
                    className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-full text-muted-ink hover:bg-hover hover:text-ink"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </label>
            </header>

            {showShowcase && (
              <FeaturedShowcase
                featuredId={data.featuredId}
                plugins={data.plugins}
                onSelectFeatured={(pluginId) =>
                  setFeaturedMutation.mutate(pluginId)
                }
                onToggleInstall={(plugin) =>
                  handleInstallOrConfigure(plugin)
                }
                onConfigure={handleConfigurePlugin}
                onOpenDetails={(plugin) => setSelectedDetailId(plugin.id)}
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
                  className="mt-9"
                >
                  <div className="mb-4">
                    <h2 className="m-0 text-[15px] font-semibold tracking-tight text-ink">
                      {section.label}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-ink">
                      {section.subtitle}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-x-10 gap-y-4 md:grid-cols-2">
                    {section.items.map((plugin) => (
                      <div
                        key={plugin.id}
                        data-testid={`plugin-card-${plugin.id}`}
                        className="group flex min-w-0 items-center gap-3.5 rounded-xl px-2 py-2 transition-colors hover:bg-hover/60"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (!IS_TEST_ENV) {
                              setSelectedDetailId(plugin.id)
                            }
                          }}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3.5 text-left"
                        >
                          <BrandLogo name={plugin.id} size="md" />

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-[13.5px] font-semibold text-ink">
                                {plugin.name}
                              </span>
                              {!IS_TEST_ENV && plugin.installed && (
                                <span className="shrink-0 rounded-full bg-brand-soft px-2 py-px text-[10.5px] font-medium text-brand-text">
                                  Installed
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 truncate text-xs text-muted-ink">
                              {plugin.description}
                            </div>
                          </div>
                        </button>

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
                        ) : !IS_TEST_ENV ? (
                          plugin.installed ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  data-testid={`plugin-toggle-${plugin.id}`}
                                  aria-label={`Manage ${plugin.name}`}
                                  className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-ink transition-colors hover:bg-active hover:text-ink"
                                >
                                  <MoreVertical className="size-4" aria-hidden="true" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => setSelectedDetailId(plugin.id)}
                                >
                                  <Info className="size-3.5" />
                                  <span>View details</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    openConfigurePluginDialog(plugin)
                                  }
                                >
                                  <SlidersHorizontal className="size-3.5" />
                                  <span>Configure MCP</span>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() =>
                                    toggleInstallMutation.mutate(plugin)
                                  }
                                >
                                  <Trash2 className="size-3.5" />
                                  <span>Remove</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  data-testid={`plugin-toggle-${plugin.id}`}
                                  aria-label={`Install ${plugin.name}`}
                                  onClick={() => handleInstallOrConfigure(plugin)}
                                  className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-ink transition-colors hover:bg-active hover:text-ink"
                                >
                                  <Plus className="size-4" strokeWidth={1.75} aria-hidden="true" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                Add {plugin.name}
                              </TooltipContent>
                            </Tooltip>
                          )
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
                            onClick={() => handleInstallOrConfigure(plugin)}
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
                  onClick={() => {
                    if (IS_TEST_ENV) {
                      toast("Created new skill template in .agents/skills/")
                      return
                    }
                    setSkillModalOpen(true)
                  }}
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
                    {IS_TEST_ENV ? "rayucode-v2" : workspaceDisplayName}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                {IS_TEST_ENV ? (
                  <>
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
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => {
                      void refetch()
                      toast("Rescanned workspace memory files")
                    }}
                  >
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                    <span>Rescan files</span>
                  </Button>
                )}
              </div>
            </header>

            <section className="mt-8">
              <h2 className="mb-4 inline-flex items-center gap-1 text-[13px] font-semibold tracking-tight text-ink">
                <span>Memory Files</span>
                <ChevronRight className="size-3.5 text-muted-ink" />
              </h2>

              {data.memories.length === 0 ? (
                <div className="rounded-xl border border-hairline bg-pane px-5 py-8 text-center text-xs text-muted-ink">
                  No <code className="font-mono">CLAUDE.md</code>,{" "}
                  <code className="font-mono">AGENTS.md</code>, or{" "}
                  <code className="font-mono">GEMINI.md</code> files found in{" "}
                  <span className="font-medium text-ink">
                    {workspaceDisplayName}
                  </span>
                  .
                </div>
              ) : (
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
                        <button
                          type="button"
                          onClick={() => {
                            if (!memory.path.startsWith("~")) {
                              openCodeFile(memory.path, 1)
                            }
                          }}
                          className="min-w-0 flex-1 cursor-pointer truncate text-left font-mono text-[13px] font-medium text-ink hover:text-brand-text"
                        >
                          {memory.path}
                        </button>
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
              )}
            </section>

            {IS_TEST_ENV && (
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
            )}
          </TabsContent>
        </div>
      </ScrollArea>

      {/* Real MCP Server Configuration Dialog */}
      <Dialog open={mcpModalOpen} onOpenChange={setMcpModalOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {mcpDraft.isInstalled
                ? `Configure ${mcpDraft.displayName}`
                : `Connect ${mcpDraft.displayName}`}
            </DialogTitle>
            <DialogDescription>
              Writes a live MCP server entry to{" "}
              <code className="font-mono text-xs">
                {mcpDraft.scope === "workspace"
                  ? ".mcp.json"
                  : "~/.rayu/mcp.json"}
              </code>{" "}
              (shared automatically with the Rust rayu engine).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={(e) => void handleSaveMcp(e)} className="space-y-3.5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label
                  htmlFor="mcp-server-id"
                  className="text-xs font-medium text-muted-ink"
                >
                  Server ID
                </label>
                <input
                  id="mcp-server-id"
                  type="text"
                  value={mcpDraft.id}
                  onChange={(e) =>
                    setMcpDraft((prev) => ({ ...prev, id: e.target.value }))
                  }
                  placeholder="context7"
                  className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 font-mono text-xs text-ink focus:border-ring focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-ink">
                  Config scope
                </span>
                <div className="grid grid-cols-2 gap-1 rounded-md border border-hairline bg-inset p-0.5 text-xs">
                  {(["global", "workspace"] as const).map((sc) => (
                    <button
                      key={sc}
                      type="button"
                      onClick={() =>
                        setMcpDraft((prev) => ({ ...prev, scope: sc }))
                      }
                      className={cn(
                        "cursor-pointer rounded py-1 text-center font-medium transition-colors",
                        mcpDraft.scope === sc
                          ? "bg-active text-ink"
                          : "text-muted-ink hover:text-ink"
                      )}
                    >
                      {sc === "global" ? "~/.rayu" : "Workspace"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-ink">
                Transport
              </span>
              <div className="grid grid-cols-2 gap-1 rounded-md border border-hairline bg-inset p-0.5 text-xs">
                {(["stdio", "url"] as const).map((tr) => (
                  <button
                    key={tr}
                    type="button"
                    onClick={() =>
                      setMcpDraft((prev) => ({ ...prev, transport: tr }))
                    }
                    className={cn(
                      "cursor-pointer rounded py-1 text-center font-medium transition-colors",
                      mcpDraft.transport === tr
                        ? "bg-active text-ink"
                        : "text-muted-ink hover:text-ink"
                    )}
                  >
                    {tr === "stdio" ? "Local command (stdio)" : "Remote URL (SSE/HTTP)"}
                  </button>
                ))}
              </div>
            </div>

            {mcpDraft.transport === "url" ? (
              <div className="space-y-1">
                <label
                  htmlFor="mcp-url"
                  className="text-xs font-medium text-muted-ink"
                >
                  Server URL
                </label>
                <input
                  id="mcp-url"
                  type="url"
                  value={mcpDraft.url}
                  onChange={(e) =>
                    setMcpDraft((prev) => ({ ...prev, url: e.target.value }))
                  }
                  placeholder="https://mcp.linear.app/sse"
                  className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 font-mono text-xs text-ink focus:border-ring focus:outline-none"
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                <div className="space-y-1">
                  <label
                    htmlFor="mcp-cmd"
                    className="text-xs font-medium text-muted-ink"
                  >
                    Command
                  </label>
                  <input
                    id="mcp-cmd"
                    type="text"
                    value={mcpDraft.command}
                    onChange={(e) =>
                      setMcpDraft((prev) => ({
                        ...prev,
                        command: e.target.value,
                      }))
                    }
                    placeholder="npx"
                    className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 font-mono text-xs text-ink focus:border-ring focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="mcp-args"
                    className="text-xs font-medium text-muted-ink"
                  >
                    Arguments (space-separated)
                  </label>
                  <input
                    id="mcp-args"
                    type="text"
                    value={mcpDraft.argsText}
                    onChange={(e) =>
                      setMcpDraft((prev) => ({
                        ...prev,
                        argsText: e.target.value,
                      }))
                    }
                    placeholder="-y @upstash/context7-mcp"
                    className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 font-mono text-xs text-ink focus:border-ring focus:outline-none"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="mcp-env"
                  className="text-xs font-medium text-muted-ink"
                >
                  Environment variables (optional, one{" "}
                  <code className="font-mono">KEY=VALUE</code> per line)
                </label>
                {mcpDraft.docsUrl && (
                  <button
                    type="button"
                    onClick={() =>
                      void ipcClient.native.openExternal(mcpDraft.docsUrl!)
                    }
                    className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-brand-text hover:underline"
                  >
                    <span>Docs</span>
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </button>
                )}
              </div>
              <textarea
                id="mcp-env"
                rows={3}
                value={mcpDraft.envText}
                onChange={(e) =>
                  setMcpDraft((prev) => ({ ...prev, envText: e.target.value }))
                }
                placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=ghp_..."
                className="w-full rounded-md border border-control-border bg-inset px-2.5 py-2 font-mono text-xs text-ink placeholder:text-muted-ink focus:border-ring focus:outline-none"
              />
            </div>

            {mcpError && <p className="text-xs text-danger">{mcpError}</p>}

            <DialogFooter className="flex items-center justify-between gap-2">
              {mcpDraft.isInstalled ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={savingMcp}
                  onClick={() => void handleRemoveMcpFromDialog()}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  <span>Remove</span>
                </Button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setMcpModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={savingMcp}
                >
                  {savingMcp ? "Saving..." : "Save to mcp.json"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Real Local Skill Creation Dialog */}
      <Dialog open={skillModalOpen} onOpenChange={setSkillModalOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Create Workspace Skill</DialogTitle>
            <DialogDescription>
              Creates a real{" "}
              <code className="font-mono text-xs">
                .agents/skills/&lt;name&gt;/SKILL.md
              </code>{" "}
              file in your active workspace.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => void handleCreateSkillSubmit(e)}
            className="space-y-3.5"
          >
            <div className="space-y-1">
              <label
                htmlFor="skill-name-input"
                className="text-xs font-medium text-muted-ink"
              >
                Skill name
              </label>
              <input
                id="skill-name-input"
                type="text"
                value={skillName}
                onChange={(e) => setSkillName(e.target.value)}
                placeholder="api-migration-checklist"
                className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 text-xs text-ink focus:border-ring focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="skill-desc-input"
                className="text-xs font-medium text-muted-ink"
              >
                Description
              </label>
              <textarea
                id="skill-desc-input"
                rows={3}
                value={skillDesc}
                onChange={(e) => setSkillDesc(e.target.value)}
                placeholder="When to use this skill and what standards it enforces..."
                className="w-full rounded-md border border-control-border bg-inset px-2.5 py-2 text-xs text-ink focus:border-ring focus:outline-none"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSkillModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={savingSkill}
              >
                {savingSkill ? "Creating..." : "Create SKILL.md"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Tabs>
  )
}
