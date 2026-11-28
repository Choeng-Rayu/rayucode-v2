import * as React from "react";
import { Box, Brain, Layers, Plug } from "lucide-react";

import {
  Badge,
  BrandLogo,
  PluginsSkeleton,
  ScrollArea,
  SectionErrorBoundary,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { cn } from "@/lib";

import {
  type PluginsTabId,
  useMcpConnectors,
  useMemoryStatus,
  useSkills,
} from "../hooks/usePlugins";
import { McpConnectorsTab } from "./McpConnectorsTab";
import { MemoryGraphTab } from "./MemoryGraphTab";
import { SkillsTab } from "./SkillsTab";
import { WorkspaceToolsTab } from "./WorkspaceToolsTab";

export interface PluginsViewProps {
  initialTab?: PluginsTabId;
  className?: string;
}

const CUSTOMIZE_NAV_ITEMS: ReadonlyArray<{
  id: PluginsTabId;
  label: string;
}> = [
  { id: "mcp", label: "Plugins & MCP" },
  { id: "skills", label: "Skills" },
  { id: "memory", label: "Memory" },
  { id: "workspace", label: "Workspace" },
];

function NavIcon({ id }: { id: PluginsTabId }) {
  switch (id) {
    case "mcp":
      return <Plug className="size-3.5" aria-hidden="true" />;
    case "skills":
      return <Box className="size-3.5" aria-hidden="true" />;
    case "memory":
      return <Brain className="size-3.5" aria-hidden="true" />;
    case "workspace":
      return <Layers className="size-3.5" aria-hidden="true" />;
  }
}

function PluginsViewContent({
  initialTab = "mcp",
  className,
}: PluginsViewProps) {
  const [activeTab, setActiveTab] = React.useState<PluginsTabId>(initialTab);

  const { data: mcpData, isLoading: mcpLoading } = useMcpConnectors();
  const { data: skillsData } = useSkills();
  const { data: memoryData } = useMemoryStatus();

  if (mcpLoading && !mcpData) {
    return <PluginsSkeleton />;
  }

  const servers = mcpData?.servers ?? [];
  const skillsCount = skillsData?.skills.length ?? 0;
  const memoryCount = memoryData?.facts.length ?? 0;

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as PluginsTabId)}
      data-testid="plugins-view"
      className={cn(
        "flex h-full min-h-0 w-full flex-col gap-0 bg-canvas @container/plugins @min-[820px]/plugins:data-[orientation=horizontal]:flex-row",
        className,
      )}
    >
      {/* Wide (>=820px inside Plugins container): 200px Left Customize Sub-Rail */}
      <aside
        aria-label="Customize navigation"
        data-testid="plugins-customize-rail"
        className="hidden w-[200px] shrink-0 flex-col border-r border-hairline bg-chrome/40 px-3 py-4 select-none @min-[820px]/plugins:flex"
      >
        <div className="mb-2.5 px-2 text-xs font-semibold tracking-tight text-muted-ink uppercase">
          Customize
        </div>

        <div className="flex flex-col gap-1">
          {CUSTOMIZE_NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`plugins-rail-tab-${item.id}`}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between gap-2 rounded-[9px] px-2.5 py-2 text-left text-xs transition-colors",
                  isActive
                    ? "bg-active font-medium text-ink shadow-bevel-surface"
                    : "text-body hover:bg-hover hover:text-ink",
                )}
              >
                <span className="flex items-center gap-2 truncate">
                  <NavIcon id={item.id} />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === "mcp" && servers.length > 0 && (
                  <span className="font-mono text-[10px] text-muted-ink tabular-nums">
                    {servers.length}
                  </span>
                )}
                {item.id === "skills" && skillsCount > 0 && (
                  <span className="font-mono text-[10px] text-muted-ink tabular-nums">
                    {skillsCount}
                  </span>
                )}
                {item.id === "memory" && memoryCount > 0 && (
                  <span className="font-mono text-[10px] text-muted-ink tabular-nums">
                    {memoryCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Active MCP Connectors Summary in Rail */}
        <div className="mt-6 flex min-h-0 flex-1 flex-col border-t border-hairline pt-4">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-[11px] font-medium text-muted-ink">
              Configured MCP
            </span>
            <Badge
              variant="secondary"
              className="px-1.5 py-0 font-mono text-[10px]"
            >
              {servers.length}
            </Badge>
          </div>

          <div className="flex flex-col gap-1">
            {servers.map((srv) => (
              <button
                key={srv.id}
                type="button"
                onClick={() => setActiveTab("mcp")}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-body transition-colors hover:bg-hover hover:text-ink"
              >
                <BrandLogo name={srv.brandId ?? srv.id} size="sm" />
                <span className="min-w-0 flex-1 truncate">{srv.name}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Compact / Medium (<820px inside Plugins container): Top 4-Segment Radix Tabs Bar */}
      <div className="shrink-0 overflow-x-auto border-b border-hairline bg-chrome/40 px-3 py-2 @min-[480px]/plugins:px-4 @min-[480px]/plugins:py-2.5 @min-[820px]/plugins:hidden">
        <TabsList className="w-fit min-w-max">
          {CUSTOMIZE_NAV_ITEMS.map((item) => (
            <TabsTrigger
              key={item.id}
              value={item.id}
              data-testid={`plugins-top-tab-${item.id}`}
            >
              <NavIcon id={item.id} />
              <span>{item.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {/* Main Scrollable Content Area */}
      <ScrollArea className="min-h-0 min-w-0 flex-1 @container/plugins-stage">
        <div className="mx-auto w-full max-w-[1000px] px-3 py-4 @min-[480px]/plugins-stage:px-5 @min-[680px]/plugins-stage:px-7 @min-[680px]/plugins-stage:py-6">
          <TabsContent value="mcp" className="m-0">
            <McpConnectorsTab />
          </TabsContent>

          <TabsContent value="skills" className="m-0">
            <SkillsTab />
          </TabsContent>

          <TabsContent value="memory" className="m-0">
            <MemoryGraphTab />
          </TabsContent>

          <TabsContent value="workspace" className="m-0">
            <WorkspaceToolsTab />
          </TabsContent>
        </div>
      </ScrollArea>
    </Tabs>
  );
}

export function PluginsView(props: PluginsViewProps) {
  return (
    <SectionErrorBoundary title="Plugins & MCP">
      <React.Suspense fallback={<PluginsSkeleton />}>
        <PluginsViewContent {...props} />
      </React.Suspense>
    </SectionErrorBoundary>
  );
}
