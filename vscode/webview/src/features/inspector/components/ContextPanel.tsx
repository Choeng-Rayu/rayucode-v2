import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  CheckCircle2,
  ChevronRight,
  Circle,
  FileDiff,
  FileText,
  Folder,
  Gauge,
  GitBranch,
  Layers,
  Minimize2,
  Monitor,
  Settings,
  Sparkles,
} from "lucide-react";

import {
  Badge,
  BrandLogo,
  Button,
  ContextSkeleton,
  ErrorState,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import { callRpc, cn, useAppStore } from "@/lib";
import type {
  CacheTtl,
  ContextCategoryItemView,
  ContextSnapshotView,
} from "@shared/vscodeProtocol";

export interface NormalizedContextCategoryRow {
  id: "system" | "tools" | "memory" | "files" | "messages" | "free" | string;
  label: string;
  tokens: number;
  tokensLabel: string;
  pctLabel: string;
  widthPct: number;
  colorClass: string;
  dotted: boolean;
  items: ContextCategoryItemView[];
}

const CATEGORY_COLOR_MAP: Record<string, string> = {
  system: "bg-code-fn",
  tools: "bg-code-kw",
  memory: "bg-code-num",
  files: "bg-brand",
  messages: "bg-code-type",
  buffer: "bg-warn",
  free: "bg-active",
};

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    const k = tokens / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return `${tokens}`;
}

export function normalizeContextCategories(
  snapshot: ContextSnapshotView,
): NormalizedContextCategoryRow[] {
  const maxTokens = Math.max(1, snapshot.maxTokens || 200_000);
  const byId = new Map(snapshot.categories.map((c) => [c.id, c]));

  const systemTokens = byId.get("system")?.tokens ?? 6_400;
  const toolsTokens =
    byId.get("tools")?.tokens ??
    Math.round((byId.get("system")?.tokens ?? 12_400) * 0.35);
  const memoryTokens = byId.get("memory")?.tokens ?? 2_400;
  const filesTokens = byId.get("files")?.tokens ?? 14_200;
  const messagesTokens = byId.get("messages")?.tokens ?? 8_200;
  const freeTokens =
    snapshot.freeTokens ??
    Math.max(
      0,
      maxTokens -
        (systemTokens + toolsTokens + memoryTokens + filesTokens + messagesTokens),
    );

  const specs: Array<{
    id: string;
    label: string;
    tokens: number;
    dotted: boolean;
    defaultItems: ContextCategoryItemView[];
  }> = [
    {
      id: "system",
      label: "System & Rules",
      tokens: systemTokens,
      dotted: true,
      defaultItems: [
        { name: "AGENTS.md & VSCODE_DESIGN.md", tokens: 3_200 },
        { name: "Harness system prompt", tokens: Math.max(400, systemTokens - 3_200) },
      ],
    },
    {
      id: "tools",
      label: "MCP & Built-in Tools",
      tokens: toolsTokens,
      dotted: true,
      defaultItems: [
        { name: "45 Rust engine tools", tokens: 2_600 },
        { name: "MCP schema cache (GitHub, Linear, Context7)", tokens: Math.max(400, toolsTokens - 2_600) },
      ],
    },
    {
      id: "memory",
      label: "Memory & Skills",
      tokens: memoryTokens,
      dotted: true,
      defaultItems: [
        { name: "Semantic memory graph (2 project facts)", tokens: 1_200 },
        { name: "Active skills (rust-verify, pr-review)", tokens: Math.max(200, memoryTokens - 1_200) },
      ],
    },
    {
      id: "files",
      label: "Attached Files",
      tokens: filesTokens,
      dotted: true,
      defaultItems: [
        { name: "vscode/webview/src/styles/globals.css", tokens: 6_800 },
        { name: "crates/rayu-harness/src/lookup.rs", tokens: Math.max(600, filesTokens - 6_800) },
      ],
    },
    {
      id: "messages",
      label: "Messages",
      tokens: messagesTokens,
      dotted: false,
      defaultItems: [],
    },
    {
      id: "free",
      label: "Free space",
      tokens: freeTokens,
      dotted: false,
      defaultItems: [],
    },
  ];

  return specs.map((spec) => {
    const rawCat = byId.get(spec.id);
    const items =
      rawCat?.items && rawCat.items.length > 0
        ? rawCat.items
        : spec.defaultItems;
    const pct = Math.min(100, (spec.tokens / maxTokens) * 100);
    return {
      id: spec.id,
      label: rawCat?.label ?? spec.label,
      tokens: spec.tokens,
      tokensLabel: formatTokenCount(spec.tokens),
      pctLabel: `${pct < 1 && pct > 0 ? pct.toFixed(1) : Math.round(pct)}%`,
      widthPct: Math.max(1.5, pct),
      colorClass: CATEGORY_COLOR_MAP[spec.id] ?? "bg-brand",
      dotted: spec.dotted,
      items,
    };
  });
}

export interface ContextPanelProps {
  sessionId?: string;
  snapshotOverride?: ContextSnapshotView;
  className?: string;
}

export function ContextPanel({
  sessionId: sessionIdProp,
  snapshotOverride,
  className,
}: ContextPanelProps) {
  const queryClient = useQueryClient();
  const storeSessionId = useAppStore((s) => s.activeSessionId);
  const sessionId = sessionIdProp ?? storeSessionId ?? "ses_vscode_shell";
  const workspaces = useAppStore((s) => s.workspaces);
  const daemonStatus = useAppStore((s) => s.daemonStatus);
  const backgroundTasks = useAppStore((s) => s.backgroundTasks);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);
  const openRightTab = useAppStore((s) => s.openRightTab);
  const openCodeFile = useAppStore((s) => s.openCodeFile);
  const setBackgroundDrawerOpen = useAppStore((s) => s.setBackgroundDrawerOpen);

  const [expandedRowIds, setExpandedRowIds] = React.useState<
    Record<string, boolean>
  >({});
  const [expandedDiscIds, setExpandedDiscIds] = React.useState<
    Record<string, boolean>
  >({});
  const [showMoreConnectors, setShowMoreConnectors] = React.useState(false);
  const [compacting, setCompacting] = React.useState(false);
  const [compactedNotice, setCompactedNotice] = React.useState<string | null>(
    null,
  );
  const [cacheTtl, setCacheTtl] = React.useState<CacheTtl>("5m");

  const contextQuery = useQuery({
    queryKey: ["inspector", "context", sessionId],
    queryFn: () => callRpc("workspace.contextSnapshot", { sessionId }),
    enabled: !snapshotOverride,
    staleTime: 15_000,
  });

  const mcpQuery = useQuery({
    queryKey: ["inspector", "mcp"],
    queryFn: () => callRpc("plugins.mcp.list"),
    staleTime: 30_000,
  });

  const skillsQuery = useQuery({
    queryKey: ["inspector", "skills"],
    queryFn: () => callRpc("plugins.skills.list"),
    staleTime: 30_000,
  });

  const memoryQuery = useQuery({
    queryKey: ["inspector", "memory"],
    queryFn: () => callRpc("plugins.memory.status"),
    staleTime: 30_000,
  });

  const todosQuery = useQuery({
    queryKey: ["inspector", "todos", sessionId],
    queryFn: () => callRpc("inspector.todos.get", { sessionId }),
    staleTime: 15_000,
  });

  const sidePanelQuery = useQuery({
    queryKey: ["inspector", "sidePanel", sessionId],
    queryFn: () => callRpc("inspector.sidePanel.get", { sessionId }),
    staleTime: 15_000,
  });

  const changesQuery = useQuery({
    queryKey: ["inspector", "changes", sessionId],
    queryFn: () => callRpc("changes.status", { sessionId }),
    staleTime: 15_000,
  });

  const snapshot = snapshotOverride ?? contextQuery.data;

  React.useEffect(() => {
    if (snapshot?.cacheTtl) {
      setCacheTtl(snapshot.cacheTtl);
    }
  }, [snapshot?.cacheTtl]);

  if (!snapshotOverride && contextQuery.isLoading) {
    return <ContextSkeleton />;
  }

  if (!snapshotOverride && (contextQuery.isError || !snapshot)) {
    return (
      <div className="p-4">
        <ErrorState
          title="Unable to load session context"
          description="Could not read context statistics from the RayuCode daemon."
          actionLabel="Retry"
          onRetry={() => {
            void contextQuery.refetch();
          }}
        />
      </div>
    );
  }

  const activeSnapshot: ContextSnapshotView = snapshot!;
  const rows = normalizeContextCategories(activeSnapshot);
  const usedRows = rows.filter((r) => r.id !== "free");
  const freeRow = rows.find((r) => r.id === "free");

  const servers = mcpQuery.data?.servers ?? [];
  const visibleServers = showMoreConnectors ? servers : servers.slice(0, 3);
  const skills = skillsQuery.data?.skills ?? [];
  const memoryFacts = memoryQuery.data?.facts ?? [];
  const todos = todosQuery.data?.todos ?? [];
  const sidePanelPages = sidePanelQuery.data?.pages ?? [];
  const changes = changesQuery.data;

  const toggleRow = (id: string) => {
    setExpandedRowIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleDisc = (id: string) => {
    setExpandedDiscIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCompact = async () => {
    if (compacting) return;
    setCompacting(true);
    try {
      await callRpc("workspace.compact", { sessionId });
      setCompactedNotice("Context compacted");
      await queryClient.invalidateQueries({
        queryKey: ["inspector", "context", sessionId],
      });
    } catch {
      // ignore offline error
    } finally {
      setCompacting(false);
    }
  };

  const handleSetCap = async () => {
    try {
      await callRpc("workspace.setContextCap", {
        sessionId,
        maxTokens: 120_000,
      });
      setCompactedNotice("Context cap set to 120k");
    } catch {
      // ignore offline error
    }
  };

  const handleTransfer = async () => {
    try {
      await callRpc("sessions.transfer", { sessionId });
      setCompactedNotice("Session ready for handoff");
    } catch {
      // ignore offline error
    }
  };

  const handleToggleTtl = async () => {
    const next: CacheTtl = cacheTtl === "5m" ? "1h" : "5m";
    setCacheTtl(next);
    try {
      await callRpc("settings.models.setCacheTtl", {
        ttl: next,
        sessionId,
      });
    } catch {
      // ignore offline error
    }
  };

  const primaryWorkspace = workspaces[0] ?? {
    name: "Workspace",
    path: ".",
    branch: changes?.branch ?? "main",
  };

  const disclosures = [
    {
      id: "mcp",
      label: "MCP tools",
      count: servers.reduce((acc, s) => acc + (s.cachedToolCount ?? 0), 0),
      items: servers.map(
        (s) => `${s.name} (${s.cachedToolCount ?? 0} tools · ${s.transport})`,
      ),
    },
    {
      id: "skills",
      label: "Active skills",
      count: skills.length,
      items: skills.map((sk) => `${sk.name} (${sk.scope})`),
    },
    {
      id: "memory",
      label: "Memory facts",
      count: memoryFacts.length,
      items: memoryFacts.map((m) => m.content),
    },
  ];

  return (
    <ScrollArea
      data-slot="context-panel"
        data-testid="inspector-context-panel"
        className={cn("min-h-0 flex-1 bg-canvas", className)}
      >
        <div className="flex flex-col divide-y divide-hairline-soft">
          {/* 1. Environment */}
          <section aria-label="Environment" className="px-[18px] py-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="m-0 text-[12.5px] font-medium text-muted-ink">
                Environment
              </h2>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Environment settings"
                    onClick={() => setActiveRoute("settings")}
                    className="grid size-6 cursor-pointer place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink"
                  >
                    <Settings
                      className="size-3.5"
                      strokeWidth={1.65}
                      aria-hidden="true"
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Environment settings
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="flex flex-col gap-2.5 text-[13px] text-ink">
              <div className="flex min-w-0 items-center gap-2.5">
                <Monitor
                  className="size-[15px] shrink-0 text-muted-ink"
                  strokeWidth={1.6}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">
                  Rayu Daemon ({daemonStatus.state})
                </span>
                <Badge variant="brand" className="font-mono text-[10px]">
                  {daemonStatus.protocolVersion ?? "v1.14"}
                </Badge>
              </div>

              <div className="flex min-w-0 items-center gap-2.5">
                <Folder
                  className="size-[15px] shrink-0 text-muted-ink"
                  strokeWidth={1.6}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-ink">
                  {primaryWorkspace.name}{" "}
                  <span className="text-muted-ink">
                    · {primaryWorkspace.path}
                  </span>
                </span>
              </div>

              <div className="flex min-w-0 items-center gap-2.5">
                <GitBranch
                  className="size-[15px] shrink-0 text-muted-ink"
                  strokeWidth={1.6}
                  aria-hidden="true"
                />
                <span className="truncate font-mono text-[12.5px] text-body">
                  {primaryWorkspace.branch ?? changes?.branch ?? "main"}
                </span>
              </div>
            </div>
          </section>

          {/* 2. Context Window & Category Token Breakdown */}
          <section aria-label="Context" className="px-[18px] py-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="m-0 text-[12.5px] font-medium text-muted-ink">
                Context Window
              </h2>
              {activeSnapshot.kvCacheHitPercent !== undefined && (
                <span
                  data-testid="context-kv-cache-pct"
                  className="font-mono text-[11px] text-brand-text tabular-nums"
                >
                  {activeSnapshot.kvCacheHitPercent}% KV warm
                </span>
              )}
            </div>

            <div className="mb-2 flex items-baseline justify-between text-[13px]">
              <span
                data-testid="context-used-pct"
                className="font-medium text-ink tabular-nums"
              >
                {activeSnapshot.usedPercent.toFixed(1)}% used
              </span>
              <span
                data-testid="context-tokens-summary"
                className="font-mono text-xs text-muted-ink tabular-nums"
              >
                {formatTokenCount(activeSnapshot.usedTokens)} /{" "}
                {formatTokenCount(activeSnapshot.maxTokens)} tokens
              </span>
            </div>

            {/* Multi-segment progress bar */}
            <div
              role="img"
              data-testid="context-usage-bar"
              aria-label={`Context window breakdown: ${activeSnapshot.usedPercent.toFixed(1)}%`}
              className="mb-4 flex h-[5px] items-center gap-[2px] overflow-hidden rounded-full bg-active"
            >
              {usedRows.map((seg) => (
                <span
                  key={seg.id}
                  title={`${seg.label}: ${seg.tokensLabel}`}
                  style={{ width: `${seg.widthPct}%` }}
                  className={cn(
                    "h-full min-w-[3px] rounded-full",
                    seg.colorClass,
                  )}
                />
              ))}
            </div>

            {/* Category breakdown rows (system, tools, memory, files, messages, free) */}
            <div
              data-testid="context-category-list"
              className="flex flex-col gap-2"
            >
              {usedRows.map((row) => {
                const isExpanded = Boolean(expandedRowIds[row.id]);
                const panelId = `ctx-detail-${row.id}`;
                return (
                  <React.Fragment key={row.id}>
                    <div
                      data-testid={`context-category-${row.id}`}
                      className="grid grid-cols-[10px_minmax(0,1fr)_auto_44px] items-center gap-2.5 text-[12.5px] text-body"
                    >
                      <span
                        className={cn(
                          "size-[8px] shrink-0 rounded-[2px]",
                          row.colorClass,
                        )}
                        aria-hidden="true"
                      />
                      {row.dotted ? (
                        <button
                          type="button"
                          data-testid={`context-category-trigger-${row.id}`}
                          aria-expanded={isExpanded}
                          aria-controls={panelId}
                          onClick={() => toggleRow(row.id)}
                          className={cn(
                            "cursor-pointer justify-self-start truncate border-b border-dotted pb-px text-left transition-colors",
                            isExpanded
                              ? "border-brand-text text-ink"
                              : "border-faint text-body hover:border-muted-ink hover:text-ink",
                          )}
                        >
                          {row.label}
                        </button>
                      ) : (
                        <span className="truncate text-body">{row.label}</span>
                      )}
                      <span className="text-right font-mono text-xs text-muted-ink tabular-nums">
                        {row.tokensLabel}
                      </span>
                      <span className="text-right font-mono text-xs text-ink tabular-nums">
                        {row.pctLabel}
                      </span>
                    </div>

                    {row.dotted && isExpanded && row.items.length > 0 && (
                      <div
                        id={panelId}
                        data-testid={`ctx-breakdown-${row.id}`}
                        className="my-1 ml-[19px] flex flex-col gap-1.5 rounded-lg border border-hairline bg-inset px-2.5 py-2 text-[11.5px]"
                      >
                        {row.items.map((sub) => (
                          <div
                            key={sub.name}
                            className="flex items-center justify-between gap-2 text-body"
                          >
                            <span className="truncate">{sub.name}</span>
                            <span className="shrink-0 font-mono text-[11px] text-muted-ink tabular-nums">
                              {formatTokenCount(sub.tokens)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </React.Fragment>
                );
              })}

              {/* Free space row */}
              {freeRow && (
                <div
                  data-testid="context-category-free"
                  className="mt-1 grid grid-cols-[10px_minmax(0,1fr)_auto_44px] items-center gap-2.5 border-t border-hairline-soft pt-2 text-[12.5px] text-muted-ink"
                >
                  <span
                    className={cn(
                      "size-[8px] shrink-0 rounded-[2px]",
                      freeRow.colorClass,
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate">{freeRow.label}</span>
                  <span className="text-right font-mono text-xs text-muted-ink tabular-nums">
                    {freeRow.tokensLabel}
                  </span>
                  <span className="text-right font-mono text-xs text-body tabular-nums">
                    {freeRow.pctLabel}
                  </span>
                </div>
              )}
            </div>

            {/* Quiet Action Strip: Compact, Transfer, Cap, KV-Cache TTL */}
            <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant="default"
                size="xs"
                disabled={compacting}
                data-testid="context-compact-btn"
                onClick={() => void handleCompact()}
              >
                <Minimize2 className="size-3" aria-hidden="true" />
                <span>{compacting ? "Compacting..." : "Compact"}</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="xs"
                data-testid="context-transfer-btn"
                onClick={() => void handleTransfer()}
              >
                <ArrowRightLeft className="size-3" aria-hidden="true" />
                <span>Transfer</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="xs"
                data-testid="context-cap-btn"
                onClick={() => void handleSetCap()}
              >
                <Gauge className="size-3" aria-hidden="true" />
                <span>Cap</span>
              </Button>

              <button
                type="button"
                data-testid="context-ttl-pill"
                onClick={() => void handleToggleTtl()}
                title="Toggle Anthropic / Rayu KV-Cache TTL (5m vs 1h)"
                className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-full border border-hairline bg-inset px-2 py-0.5 font-mono text-[10.5px] text-muted-ink transition-colors hover:border-premium hover:text-ink"
              >
                <span>TTL:</span>
                <strong className="font-semibold text-brand-text">
                  {cacheTtl}
                </strong>
              </button>
            </div>

            {compactedNotice && (
              <div
                data-testid="context-action-feedback"
                className="mt-2 rounded-md border border-hairline-soft bg-inset px-2.5 py-1 text-[11.5px] text-brand-text"
              >
                {compactedNotice}
              </div>
            )}

            {/* Attached Rules, Skills, Memory & MCP Disclosures */}
            <div className="mt-3.5 flex flex-col gap-0.5">
              {disclosures.map((disc) => {
                const isOpen = Boolean(expandedDiscIds[disc.id]);
                const bodyId = `ctx-disc-body-${disc.id}`;
                return (
                  <div key={disc.id}>
                    <button
                      type="button"
                      data-testid={`context-disclosure-${disc.id}`}
                      aria-expanded={isOpen}
                      aria-controls={bodyId}
                      onClick={() => toggleDisc(disc.id)}
                      className="-mx-1.5 flex w-[calc(100%+12px)] cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[12.5px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                    >
                      <ChevronRight
                        className={cn(
                          "size-3 shrink-0 text-faint transition-transform duration-150",
                          isOpen && "rotate-90",
                        )}
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <span>{disc.label}</span>
                      <span className="ml-auto font-mono text-xs text-muted-ink tabular-nums">
                        {disc.count}
                      </span>
                    </button>
                    {isOpen && (
                      <div
                        id={bodyId}
                        className="flex flex-col gap-1 py-1 pl-[22px] font-mono text-[11px] text-muted-ink"
                      >
                        {disc.items.map((item, idx) => (
                          <span key={idx} className="truncate">
                            {item}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 3. Connectors (MCP Servers with BrandLogo) */}
          <section aria-label="Connectors" className="px-[18px] py-4">
            <h2 className="mb-3 text-[12.5px] font-medium text-muted-ink">
              Connectors ({servers.length})
            </h2>
            {visibleServers.length === 0 ? (
              <p className="m-0 text-xs text-faint">
                No MCP connectors configured.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {visibleServers.map((srv) => (
                  <div
                    key={srv.id}
                    className="flex items-center gap-2.5 text-[13px] text-ink"
                  >
                    <BrandLogo name={srv.brandId ?? srv.id} size="sm" />
                    <span className="truncate">{srv.name}</span>
                    <button
                      type="button"
                      onClick={() => setActiveRoute("plugins")}
                      className={cn(
                        "ml-auto shrink-0 cursor-pointer text-xs font-medium hover:underline",
                        srv.status === "connected" || srv.status === "cached"
                          ? "text-brand-text"
                          : "text-warn",
                      )}
                    >
                      {srv.status === "connected"
                        ? "Linked"
                        : srv.status === "cached"
                          ? "Cached"
                          : "Auth needed"}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {servers.length > 3 && (
              <button
                type="button"
                onClick={() => setShowMoreConnectors((prev) => !prev)}
                className="mt-2.5 cursor-pointer text-xs text-muted-ink hover:text-ink"
              >
                {showMoreConnectors ? "Show less" : "Show more"}
              </button>
            )}
          </section>

          {/* 4. Outputs & Todos */}
          <section aria-label="Outputs and Todos" className="px-[18px] py-4">
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="m-0 text-[12.5px] font-medium text-muted-ink">
                Outputs &amp; Todos
              </h2>
              <button
                type="button"
                onClick={() => openRightTab("tools")}
                className="cursor-pointer text-xs text-brand-text hover:underline"
              >
                View all
              </button>
            </div>

            {todos.length > 0 && (
              <div className="mb-2.5 flex flex-col gap-1">
                {todos.slice(0, 3).map((todo, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 text-xs text-body"
                  >
                    {todo.status === "completed" ? (
                      <CheckCircle2 className="size-3.5 shrink-0 text-brand-text" />
                    ) : (
                      <Circle className="size-3.5 shrink-0 text-muted-ink" />
                    )}
                    <span
                      className={cn(
                        "truncate",
                        todo.status === "completed" &&
                          "text-muted-ink line-through",
                      )}
                    >
                      {todo.content}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {sidePanelPages.length > 0 ? (
              <div className="flex flex-col gap-1">
                {sidePanelPages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => openRightTab("artifacts", page.title)}
                    className="-mx-1.5 flex w-[calc(100%+12px)] cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-hover hover:text-brand-text"
                  >
                    <FileText className="size-3.5 shrink-0 text-code-type" />
                    <span className="truncate">{page.title}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="m-0 text-xs text-faint">
                SidePanel pages and applets appear here.
              </p>
            )}
          </section>

          {/* 5. Background Processes Summary */}
          <section aria-label="Background Processes" className="px-[18px] py-4">
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="m-0 text-[12.5px] font-medium text-muted-ink">
                Background Processes ({backgroundTasks.length})
              </h2>
              {backgroundTasks.length > 0 && (
                <button
                  type="button"
                  onClick={() => setBackgroundDrawerOpen(true)}
                  className="cursor-pointer text-xs text-brand-text hover:underline"
                >
                  View all
                </button>
              )}
            </div>
            {backgroundTasks.length === 0 ? (
              <p className="m-0 text-xs text-faint">
                No active background tasks.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {backgroundTasks.map((task) => (
                  <div
                    key={task.taskId}
                    className="flex items-center justify-between gap-2 rounded-lg border border-hairline-soft bg-pane px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Layers className="size-3.5 shrink-0 text-brand-text" />
                      <span className="truncate font-mono text-ink">
                        {task.displayName}
                      </span>
                    </div>
                    <Badge variant="brand">{task.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 6. Changes Summary */}
          <section aria-label="Changes" className="px-[18px] py-4">
            <h2 className="mb-3 text-[12.5px] font-medium text-muted-ink">
              Changes
            </h2>
            <div className="flex items-center gap-2.5">
              <FileDiff
                className="size-4 shrink-0 text-muted-ink"
                strokeWidth={1.6}
                aria-hidden="true"
              />
              <span className="font-mono text-[13px] font-medium tabular-nums">
                <span className="text-brand-text">
                  +{changes?.totalAdditions ?? 0}
                </span>
                <span className="ml-1.5 text-danger">
                  -{changes?.totalDeletions ?? 0}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  const first = changes?.files[0];
                  if (first) {
                    openCodeFile(first.path, 1);
                  } else {
                    setActiveRoute("changes");
                  }
                }}
                className="cursor-pointer text-xs text-muted-ink transition-colors hover:text-ink"
              >
                Inspect
              </button>
              <Button
                type="button"
                variant="default"
                size="xs"
                onClick={() => setActiveRoute("changes")}
                className="ml-auto"
              >
                Create PR
              </Button>
            </div>
          </section>
        </div>
      </ScrollArea>
  );
}

export { Sparkles };
