import {
  ArrowLeft,
  Check,
  ExternalLink,
  FolderOpen,
  Play,
  Plus,
  Settings2,
  Wrench,
} from "lucide-react";
import type { McpServerView } from "@shared/vscodeProtocol";

import { Badge, BrandLogo, Button, ScrollArea } from "@/components/ui";
import { postToHost } from "@/lib";

import {
  type CatalogConnectorTemplate,
  findCatalogTemplate,
  normalizeConfigLayerBadge,
} from "../hooks/usePlugins";

export interface PluginDetailViewProps {
  server?: McpServerView | null;
  template?: CatalogConnectorTemplate | null;
  lastLatencyMs?: number;
  onBack: () => void;
  onConfigure: () => void;
  onTestConnection?: (serverId: string) => void;
  onInstallTemplate?: (template: CatalogConnectorTemplate) => void;
  isTesting?: boolean;
}

export function PluginDetailView({
  server,
  template,
  lastLatencyMs,
  onBack,
  onConfigure,
  onTestConnection,
  onInstallTemplate,
  isTesting = false,
}: PluginDetailViewProps) {
  const resolvedTemplate =
    template ??
    (server ? findCatalogTemplate(server.brandId ?? server.id) : undefined);

  const displayName = server?.name ?? resolvedTemplate?.name ?? "MCP Connector";
  const brandId =
    server?.brandId ?? resolvedTemplate?.brandId ?? server?.id ?? "github";
  const transport =
    server?.transport ?? resolvedTemplate?.transport ?? "stdio";
  const configLayer = server
    ? normalizeConfigLayerBadge(server.configLayer)
    : (resolvedTemplate?.configLayerLabel ?? "~/.rayu/mcp.json");
  const configPath =
    server?.configPath ??
    (server?.configLayer === "workspace" ? ".mcp.json" : "~/.rayu/mcp.json");
  const tools =
    server?.tools && server.tools.length > 0
      ? server.tools
      : (resolvedTemplate?.defaultTools ?? []);
  const tokenBudgetUsed =
    server?.tokenBudgetUsed ??
    tools.reduce((sum, t) => sum + (t.tokenEstimate ?? 140), 0);

  const samplePrompts = resolvedTemplate?.samplePrompts ?? [
    `Inspect available tools from the ${displayName} MCP server.`,
    `Use ${displayName} to verify my current workspace changes.`,
    `Summarize recent updates from ${displayName}.`,
  ];

  const handleOpenConfigFile = () => {
    postToHost({
      type: "rayucode.editor.openFile",
      path: configPath,
    });
  };

  return (
    <div
      data-testid="plugin-detail-view"
      className="flex h-full min-h-0 flex-1 flex-col bg-canvas"
    >
      {/* Top Breadcrumb Bar */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-hairline px-5 text-xs text-muted-ink">
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="plugin-detail-back-btn"
            onClick={onBack}
            className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-body transition-colors hover:text-ink"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            <span>Plugins &amp; MCP</span>
          </button>
          <span aria-hidden="true">/</span>
          <span className="font-semibold text-ink">{displayName}</span>
        </div>

        <Button
          type="button"
          variant="outline"
          size="xs"
          data-testid="open-mcp-config-in-vscode-btn"
          onClick={handleOpenConfigFile}
        >
          <FolderOpen className="size-3" aria-hidden="true" />
          <span>Open Config File in VS Code</span>
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-[840px] flex-col gap-6 px-5 py-6">
          {/* Header Card */}
          <div className="rayu-card-bevel flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-premium bg-pane p-5">
            <div className="flex items-center gap-3.5">
              <BrandLogo name={brandId} size="lg" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="m-0 text-lg font-semibold tracking-tight text-ink">
                    {displayName}
                  </h1>
                  <Badge variant={server ? "brand" : "secondary"}>
                    {server ? server.status : "Template"}
                  </Badge>
                  <Badge variant="outline" className="font-mono text-[10.5px]">
                    {transport}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-ink">
                  <span>Layer: {configLayer}</span>
                  <span>·</span>
                  <span>
                    Pool:{" "}
                    {server?.shared ?? resolvedTemplate?.shared
                      ? "shared pool"
                      : "per-session"}
                  </span>
                  {lastLatencyMs !== undefined && (
                    <>
                      <span>·</span>
                      <span className="text-brand-text tabular-nums">
                        {lastLatencyMs}ms RTT
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {server && onTestConnection ? (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  disabled={isTesting}
                  data-testid="detail-test-connection-btn"
                  onClick={() => onTestConnection(server.id)}
                >
                  <Play className="size-3" aria-hidden="true" />
                  <span>{isTesting ? "Testing..." : "Test Connection"}</span>
                </Button>
              ) : null}

              {server ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="detail-configure-btn"
                  onClick={onConfigure}
                >
                  <Settings2 className="size-3.5" aria-hidden="true" />
                  <span>Configure Server</span>
                </Button>
              ) : resolvedTemplate && onInstallTemplate ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  data-testid="detail-install-btn"
                  onClick={() => onInstallTemplate(resolvedTemplate)}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  <span>Install to mcp.json</span>
                </Button>
              ) : null}
            </div>
          </div>

          {/* Adaptive 8k Token Budget & Zero-Cache-Miss Schema Note */}
          <div className="rayu-card-bevel flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-inset px-4 py-3 text-xs">
            <div className="flex items-center gap-2">
              <Check className="size-3.5 text-brand-text" aria-hidden="true" />
              <span className="font-medium text-ink">
                Zero-Cache-Miss Schema Cache
              </span>
              <span className="text-muted-ink">
                · {tools.length} tool definitions cached on disk
              </span>
            </div>
            <span className="font-mono text-[11px] text-body tabular-nums">
              Schema footprint: ~{tokenBudgetUsed} / 8,000 adaptive token budget
            </span>
          </div>

          {/* Discovered MCP Tools List */}
          <section aria-label="Discovered MCP tools">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Wrench
                  className="size-3.5 text-brand-text"
                  aria-hidden="true"
                />
                <h2 className="m-0 text-sm font-semibold text-ink">
                  Discovered Tool Definitions ({tools.length})
                </h2>
              </div>
              <span className="font-mono text-[11px] text-muted-ink">
                mcp__{server?.id ?? resolvedTemplate?.id ?? "server"}__&lt;tool&gt;
              </span>
            </div>

            <div
              data-testid="plugin-detail-tools-list"
              className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-[14px] border border-premium bg-pane"
            >
              {tools.map((tool) => (
                <div
                  key={tool.fullName}
                  data-testid={`mcp-tool-row-${tool.name}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-inset px-2 py-0.5 font-mono text-xs font-semibold text-ink">
                        {tool.fullName}
                      </code>
                    </div>
                    {tool.description ? (
                      <p className="mt-1 text-xs text-muted-ink">
                        {tool.description}
                      </p>
                    ) : null}
                  </div>
                  {tool.tokenEstimate !== undefined && (
                    <span className="rounded bg-inset px-2 py-0.5 font-mono text-[10.5px] text-muted-ink tabular-nums">
                      ~{tool.tokenEstimate} tok
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Sample Prompts & Docs */}
          <section className="rayu-card-bevel rounded-[14px] border border-premium bg-pane p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="m-0 text-xs font-semibold text-ink uppercase">
                Example Prompts
              </h3>
              {resolvedTemplate?.docsUrl && (
                <button
                  type="button"
                  onClick={() =>
                    postToHost({
                      type: "rayucode.editor.openExternal",
                      url: resolvedTemplate.docsUrl,
                    })
                  }
                  className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-brand-text hover:underline"
                >
                  <span>Official Docs</span>
                  <ExternalLink className="size-3" aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="mt-2.5 space-y-1.5">
              {samplePrompts.map((promptText) => (
                <div
                  key={promptText}
                  className="rounded-lg border border-hairline bg-inset px-3 py-2 font-mono text-xs text-body"
                >
                  {promptText}
                </div>
              ))}
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
