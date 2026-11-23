import * as React from "react";
import {
  Check,
  Database,
  KeyRound,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  X,
} from "lucide-react";
import type { McpServerStatus, McpServerView } from "@shared/vscodeProtocol";

import {
  Badge,
  BRAND_LOGO_KEYS,
  BrandLogo,
  Button,
  RunStatusPulse,
  type RunStatusTone,
  Switch,
} from "@/components/ui";
import { cn } from "@/lib";

import {
  CATALOG_CONNECTOR_TEMPLATES,
  type CatalogConnectorTemplate,
  type ConnectorCategoryId,
  findCatalogTemplate,
  normalizeConfigLayerBadge,
  useMcpActions,
  useMcpConnectors,
} from "../hooks/usePlugins";
import { FeaturedShowcase } from "./FeaturedShowcase";
import { McpServerDialog, type McpServerDraft } from "./McpServerDialog";
import { PluginDetailView } from "./PluginDetailView";

type ScopeFilterId = "all" | "configured" | "catalog" | "connected";

const CATEGORY_FILTERS: ReadonlyArray<{
  id: ConnectorCategoryId;
  label: string;
}> = [
  { id: "all", label: "All Categories" },
  { id: "featured", label: "Featured" },
  { id: "developer", label: "Developer & Browser" },
  { id: "infrastructure", label: "Data & Infra" },
  { id: "business", label: "Workspace & Ops" },
];

function mapMcpStatusToPulseTone(status: McpServerStatus): RunStatusTone {
  switch (status) {
    case "connected":
      return "success";
    case "cached":
      return "running";
    case "auth_needed":
      return "warn";
    case "error":
      return "danger";
    case "disabled":
      return "idle";
  }
}

function formatMcpStatusLabel(status: McpServerStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "cached":
      return "Cached (connect-on-call)";
    case "auth_needed":
      return "Auth needed";
    case "disabled":
      return "Disabled";
    case "error":
      return "Error";
  }
}

export function McpConnectorsTab() {
  const { data } = useMcpConnectors();
  const {
    toggleMutation,
    testMutation,
    reloadMutation,
    saveServerMutation,
    removeServerMutation,
    oauthMutation,
  } = useMcpActions();

  const servers = data?.servers ?? [];
  const totalBudget = data?.totalTokenBudget ?? 8000;
  const usedBudget = data?.usedTokenBudget ?? 2520;

  const [searchQuery, setSearchQuery] = React.useState("");
  const [scopeFilter, setScopeFilter] = React.useState<ScopeFilterId>("all");
  const [categoryFilter, setCategoryFilter] =
    React.useState<ConnectorCategoryId>("all");
  const [featuredId, setFeaturedId] = React.useState("github");

  const [detailTarget, setDetailTarget] = React.useState<{
    server?: McpServerView;
    template?: CatalogConnectorTemplate;
  } | null>(null);

  const [testResults, setTestResults] = React.useState<
    Record<string, { ok: boolean; toolCount?: number; latencyMs?: number }>
  >({});

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dialogDraft, setDialogDraft] = React.useState<McpServerDraft>({
    mode: "add",
    id: "",
    displayName: "Custom MCP Server",
    scope: "global",
    transport: "stdio",
    command: "npx",
    argsText: "-y @upstash/context7-mcp",
    url: "",
    envText: "",
    shared: true,
    timeoutSecs: 30,
    isInstalled: false,
  });

  const installedIds = React.useMemo(
    () => new Set(servers.map((s) => s.id.toLowerCase())),
    [servers],
  );

  const sharedPoolCount = servers.filter((s) => s.shared && s.enabled).length;
  const totalCachedTools = servers.reduce(
    (sum, s) => sum + (s.cachedToolCount ?? s.tools?.length ?? 0),
    0,
  );

  const handleOpenAddCustomDialog = () => {
    setDialogDraft({
      mode: "add",
      id: "",
      displayName: "Custom MCP Server",
      scope: "global",
      transport: "stdio",
      command: "npx",
      argsText: "",
      url: "",
      envText: "",
      shared: true,
      timeoutSecs: 30,
      isInstalled: false,
    });
    setDialogOpen(true);
  };

  const handleOpenConfigureServer = (server: McpServerView) => {
    const tpl = findCatalogTemplate(server.brandId ?? server.id);
    const envKeys = server.envKeys ?? tpl?.requiredEnvKeys ?? [];
    setDialogDraft({
      mode: "edit",
      id: server.id,
      displayName: server.name,
      brandId: server.brandId ?? server.id,
      scope: server.configLayer === "workspace" ? "workspace" : "global",
      transport: server.transport,
      command: server.command ?? tpl?.command ?? "npx",
      argsText: (server.args ?? tpl?.args ?? []).join(" "),
      url: server.url ?? tpl?.url ?? "",
      envText: envKeys.map((k) => `${k}=`).join("\n"),
      shared: server.shared,
      timeoutSecs: server.timeoutSecs ?? 30,
      isInstalled: true,
    });
    setDialogOpen(true);
  };

  const handleOpenConfigureTemplate = (tpl: CatalogConnectorTemplate) => {
    const existing = servers.find(
      (s) => s.id.toLowerCase() === tpl.id.toLowerCase(),
    );
    if (existing) {
      handleOpenConfigureServer(existing);
      return;
    }
    setDialogDraft({
      mode: "add",
      id: tpl.id,
      displayName: tpl.name,
      brandId: tpl.brandId,
      scope: tpl.configLayerLabel.includes("workspace")
        ? "workspace"
        : "global",
      transport: tpl.transport,
      command: tpl.command ?? "npx",
      argsText: (tpl.args ?? []).join(" "),
      url: tpl.url ?? "",
      envText: (tpl.requiredEnvKeys ?? []).map((k) => `${k}=`).join("\n"),
      shared: tpl.shared,
      timeoutSecs: 30,
      isInstalled: false,
    });
    setDialogOpen(true);
  };

  const handleQuickInstallTemplate = (tpl: CatalogConnectorTemplate) => {
    if (tpl.requiredEnvKeys && tpl.requiredEnvKeys.length > 0) {
      handleOpenConfigureTemplate(tpl);
      return;
    }
    saveServerMutation.mutate({
      mode: "add",
      id: tpl.id,
      name: tpl.name,
      brandId: tpl.brandId,
      scope: tpl.configLayerLabel.includes("workspace")
        ? "workspace"
        : "global",
      transport: tpl.transport,
      command: tpl.command,
      args: tpl.args,
      url: tpl.url,
      shared: tpl.shared,
      timeoutSecs: 30,
    });
  };

  const handleTestServer = async (id: string) => {
    const res = await testMutation.mutateAsync(id);
    setTestResults((prev) => ({
      ...prev,
      [id]: {
        ok: res.ok,
        toolCount: res.toolCount,
        latencyMs: res.latencyMs,
      },
    }));
  };

  if (detailTarget) {
    const liveServer = detailTarget.server
      ? (servers.find((s) => s.id === detailTarget.server?.id) ??
        detailTarget.server)
      : undefined;
    return (
      <PluginDetailView
        server={liveServer}
        template={detailTarget.template}
        lastLatencyMs={
          liveServer ? testResults[liveServer.id]?.latencyMs : undefined
        }
        onBack={() => setDetailTarget(null)}
        onConfigure={() => {
          if (liveServer) {
            handleOpenConfigureServer(liveServer);
          } else if (detailTarget.template) {
            handleOpenConfigureTemplate(detailTarget.template);
          }
        }}
        onTestConnection={(id) => {
          void handleTestServer(id);
        }}
        onInstallTemplate={(tpl) => {
          handleQuickInstallTemplate(tpl);
          setDetailTarget(null);
        }}
        isTesting={testMutation.isPending}
      />
    );
  }

  const q = searchQuery.trim().toLowerCase();

  const filteredServers = servers.filter((srv) => {
    if (scopeFilter === "catalog") return false;
    if (scopeFilter === "connected" && srv.status !== "connected") return false;
    const tpl = findCatalogTemplate(srv.brandId ?? srv.id);
    if (
      categoryFilter !== "all" &&
      tpl &&
      tpl.category !== categoryFilter
    ) {
      return false;
    }
    if (!q) return true;
    const haystack = [
      srv.id,
      srv.name,
      srv.transport,
      srv.configLayer,
      tpl?.description ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });

  const filteredCatalog = CATALOG_CONNECTOR_TEMPLATES.filter((tpl) => {
    if (scopeFilter === "configured" || scopeFilter === "connected") {
      return false;
    }
    if (categoryFilter !== "all" && tpl.category !== categoryFilter) {
      return false;
    }
    if (!q) return true;
    const haystack = [
      tpl.id,
      tpl.name,
      tpl.description,
      tpl.category,
      tpl.transport,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });

  return (
    <div data-testid="mcp-connectors-tab" className="flex flex-col gap-6">
      {/* Header & Controls */}
      <header className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="m-0 text-xl font-semibold tracking-tight text-ink">
              Plugins &amp; 7-Layer MCP
            </h1>
            <p className="mt-0.5 text-xs text-muted-ink">
              Merges 7 config sources with Shared Process Pool, Zero-Cache-Miss
              Schema Cache, and OAuth 2.1.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={reloadMutation.isPending}
              data-testid="reload-all-mcp-btn"
              onClick={() => reloadMutation.mutate()}
            >
              <RefreshCw
                className={cn(
                  "size-3.5",
                  reloadMutation.isPending && "animate-spin",
                )}
                aria-hidden="true"
              />
              <span>Reload All</span>
            </Button>

            <Button
              type="button"
              variant="primary"
              size="sm"
              data-testid="add-mcp-server-btn"
              onClick={handleOpenAddCustomDialog}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              <span>Add MCP Server</span>
            </Button>
          </div>
        </div>

        {/* Shared Pool & Schema Cache Status Strip */}
        <div
          data-testid="mcp-pool-schema-status-strip"
          className="rayu-card-bevel flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-pane px-3.5 py-2.5 text-xs"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 font-medium text-ink">
              <Database
                className="size-3.5 text-brand-text"
                aria-hidden="true"
              />
              <span>Shared Pool:</span>
              <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-brand-text tabular-nums">
                {sharedPoolCount} pooled
              </code>
            </span>
            <span className="text-muted-ink">·</span>
            <span className="text-muted-ink">
              Schema Cache:{" "}
              <strong className="font-mono text-body tabular-nums">
                {totalCachedTools} tools cached
              </strong>{" "}
              (0 KV misses)
            </span>
            <span className="text-muted-ink">·</span>
            <span className="text-muted-ink">
              7-Layer Discovery ({BRAND_LOGO_KEYS.length} official BrandLogos)
            </span>
          </div>

          <span className="font-mono text-[11px] text-body tabular-nums">
            Adaptive Budget: {usedBudget} / {totalBudget} tok
          </span>
        </div>

        {/* Search + Scope Filter + Category Filter Row */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-hairline bg-inset px-3 focus-within:border-premium-hi sm:min-w-[220px]">
            <Search
              className="size-3.5 shrink-0 text-muted-ink"
              aria-hidden="true"
            />
            <input
              data-testid="mcp-search-input"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search connectors, tools, or servers..."
              aria-label="Search MCP connectors"
              className="w-full bg-transparent text-xs text-ink placeholder:text-muted-ink focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear connector search"
                onClick={() => setSearchQuery("")}
                className="cursor-pointer text-muted-ink hover:text-ink"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </label>

          {/* Scope Filter Pills */}
          <div className="inline-flex items-center rounded-lg border border-hairline bg-pane p-0.5 text-xs">
            {(
              [
                { id: "all", label: "All" },
                {
                  id: "configured",
                  label: `Configured (${servers.length})`,
                },
                { id: "catalog", label: "Catalog" },
                { id: "connected", label: "Connected" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                data-testid={`mcp-filter-${tab.id}`}
                onClick={() => setScopeFilter(tab.id)}
                className={cn(
                  "cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  scopeFilter === tab.id
                    ? "bg-active text-ink shadow-bevel-surface"
                    : "text-muted-ink hover:text-ink",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Category Filter Strip */}
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORY_FILTERS.map((cat) => (
            <button
              key={cat.id}
              type="button"
              data-testid={`mcp-category-${cat.id}`}
              onClick={() => setCategoryFilter(cat.id)}
              className={cn(
                "cursor-pointer rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                categoryFilter === cat.id
                  ? "border-brand/50 bg-brand-soft text-brand-text"
                  : "border-hairline bg-pane text-muted-ink hover:text-ink",
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </header>

      {/* Featured Showcase Banner */}
      {!q && (scopeFilter === "all" || scopeFilter === "catalog") && (
        <FeaturedShowcase
          featuredId={featuredId}
          templates={CATALOG_CONNECTOR_TEMPLATES}
          installedIds={installedIds}
          onSelectFeatured={setFeaturedId}
          onInstallTemplate={handleQuickInstallTemplate}
          onConfigureTemplate={handleOpenConfigureTemplate}
          onOpenDetails={(tpl) => setDetailTarget({ template: tpl })}
          isPending={saveServerMutation.isPending}
        />
      )}

      {/* Configured 7-Layer MCP Servers Section */}
      {scopeFilter !== "catalog" && (
        <section aria-label="Configured 7-layer MCP servers">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="m-0 text-sm font-semibold tracking-tight text-ink">
              Configured MCP Servers ({filteredServers.length})
            </h2>
            <span className="font-mono text-[11px] text-muted-ink">
              7-layer merged discovery
            </span>
          </div>

          <div
            data-testid="configured-mcp-servers-list"
            className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-[14px] border border-premium bg-pane"
          >
            {filteredServers.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-ink">
                No configured MCP servers match the current filter.
              </div>
            ) : (
              filteredServers.map((srv) => {
                const testResult = testResults[srv.id];
                const layerLabel = normalizeConfigLayerBadge(srv.configLayer);
                const toolCount =
                  testResult?.toolCount ??
                  srv.cachedToolCount ??
                  srv.tools?.length ??
                  0;

                return (
                  <div
                    key={srv.id}
                    data-testid={`mcp-server-card-${srv.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-xs"
                  >
                    <button
                      type="button"
                      data-testid={`mcp-server-open-detail-${srv.id}`}
                      onClick={() => setDetailTarget({ server: srv })}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                    >
                      <BrandLogo name={srv.brandId ?? srv.id} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13.5px] font-semibold text-ink">
                            {srv.name}
                          </span>
                          <RunStatusPulse
                            status={mapMcpStatusToPulseTone(srv.status)}
                            label={formatMcpStatusLabel(srv.status)}
                          />
                          <span className="text-[11px] text-muted-ink">
                            {formatMcpStatusLabel(srv.status)}
                          </span>
                        </div>

                        {/* Metadata Pills: Config Layer, Transport, Pool Mode, Schema Cache */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[10.5px]">
                          <span className="rounded border border-hairline bg-inset px-1.5 py-0.5 text-body">
                            {layerLabel}
                          </span>
                          <span className="rounded border border-hairline bg-inset px-1.5 py-0.5 text-muted-ink">
                            {srv.transport}
                          </span>
                          <span className="rounded border border-hairline bg-inset px-1.5 py-0.5 text-muted-ink">
                            {srv.shared ? "shared pool" : "per-session"}
                          </span>
                          <span className="rounded bg-brand-soft px-1.5 py-0.5 text-brand-text tabular-nums">
                            cached ({toolCount} tools)
                          </span>
                          {testResult?.latencyMs !== undefined && (
                            <span
                              data-testid={`mcp-test-result-${srv.id}`}
                              className="rounded bg-info-soft px-1.5 py-0.5 text-info tabular-nums"
                            >
                              verified · {testResult.latencyMs}ms
                            </span>
                          )}
                        </div>
                      </div>
                    </button>

                    {/* Action Strip */}
                    <div className="flex flex-wrap items-center gap-2">
                      {srv.oauthRequired && (
                        <Button
                          type="button"
                          variant={
                            srv.oauthAuthenticated ? "outline" : "primary"
                          }
                          size="xs"
                          data-testid={`mcp-oauth-btn-${srv.id}`}
                          onClick={() =>
                            oauthMutation.mutate({
                              id: srv.id,
                              action: srv.oauthAuthenticated
                                ? "logout"
                                : "login",
                            })
                          }
                        >
                          {srv.oauthAuthenticated ? (
                            <>
                              <LogOut className="size-3" aria-hidden="true" />
                              <span>Sign Out</span>
                            </>
                          ) : (
                            <>
                              <KeyRound className="size-3" aria-hidden="true" />
                              <span>Sign In (OAuth)</span>
                            </>
                          )}
                        </Button>
                      )}

                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        data-testid={`mcp-test-btn-${srv.id}`}
                        onClick={() => {
                          void handleTestServer(srv.id);
                        }}
                      >
                        <Play className="size-3" aria-hidden="true" />
                        <span>Test</span>
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        data-testid={`mcp-configure-btn-${srv.id}`}
                        onClick={() => handleOpenConfigureServer(srv)}
                      >
                        <Settings2 className="size-3" aria-hidden="true" />
                        <span>Configure</span>
                      </Button>

                      <Switch
                        checked={srv.enabled}
                        onCheckedChange={(enabled) =>
                          toggleMutation.mutate({ id: srv.id, enabled })
                        }
                        aria-label={`Toggle ${srv.name}`}
                        data-testid={`mcp-switch-${srv.id}`}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}

      {/* Curated Quick-Add Connector Catalog */}
      {scopeFilter !== "configured" && scopeFilter !== "connected" && (
        <section aria-label="Curated quick-add connector catalog">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="m-0 text-sm font-semibold tracking-tight text-ink">
                Quick-Add Connector Catalog ({filteredCatalog.length})
              </h2>
              <p className="mt-0.5 text-xs text-muted-ink">
                Templates — click Install to add to{" "}
                <code className="font-mono text-body">~/.rayu/mcp.json</code> or
                workspace{" "}
                <code className="font-mono text-body">.mcp.json</code>.
              </p>
            </div>
          </div>

          <div
            data-testid="mcp-catalog-grid"
            className="grid grid-cols-1 gap-3 @min-[700px]/app:grid-cols-2"
          >
            {filteredCatalog.map((tpl) => {
              const isInstalled = installedIds.has(tpl.id);
              return (
                <div
                  key={tpl.id}
                  data-testid={`catalog-connector-${tpl.id}`}
                  className="rayu-card-bevel flex items-center justify-between gap-3 rounded-xl border border-premium bg-pane p-3.5"
                >
                  <button
                    type="button"
                    onClick={() => setDetailTarget({ template: tpl })}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                  >
                    <BrandLogo name={tpl.brandId} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-ink">
                          {tpl.name}
                        </span>
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px]"
                        >
                          {tpl.transport}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-ink">
                        {tpl.description}
                      </p>
                    </div>
                  </button>

                  {isInstalled ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="xs"
                      data-testid={`catalog-install-btn-${tpl.id}`}
                      onClick={() => handleOpenConfigureTemplate(tpl)}
                    >
                      <Check
                        className="size-3 text-brand-text"
                        aria-hidden="true"
                      />
                      <span>Configured</span>
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="default"
                      size="xs"
                      data-testid={`catalog-install-btn-${tpl.id}`}
                      onClick={() => handleQuickInstallTemplate(tpl)}
                    >
                      <Plus className="size-3" aria-hidden="true" />
                      <span>Install</span>
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <McpServerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialDraft={dialogDraft}
        isSaving={saveServerMutation.isPending}
        onSave={async (draft) => {
          await saveServerMutation.mutateAsync(draft);
        }}
        onRemove={async (id, scope) => {
          await removeServerMutation.mutateAsync({ id, scope });
        }}
      />
    </div>
  );
}
