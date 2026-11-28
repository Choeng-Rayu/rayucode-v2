import * as React from "react";
import {
  CalendarClock,
  Moon,
  Network,
  Radar,
  ShieldCheck,
} from "lucide-react";

import {
  AutomationsSkeleton,
  Badge,
  Button,
  SectionErrorBoundary,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { cn, useAppStore } from "@/lib";

import {
  useAmbientStatus,
  useOvernightRuns,
  useSchedules,
} from "../hooks/useAutomations";
import { AmbientTab } from "./AmbientTab";
import { OvernightTab } from "./OvernightTab";
import { QualityReportsTab } from "./QualityReportsTab";
import { SchedulesTab } from "./SchedulesTab";

export type AutomationsTabId = "overnight" | "schedules" | "ambient" | "quality";

export interface AutomationsViewProps {
  initialTab?: AutomationsTabId;
  className?: string;
}

function AutomationsViewContent({
  initialTab = "overnight",
  className,
}: AutomationsViewProps) {
  const [activeTab, setActiveTab] = React.useState<AutomationsTabId>(initialTab);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);

  const overnightQuery = useOvernightRuns();
  const schedulesQuery = useSchedules();
  const ambientQuery = useAmbientStatus();
  const { data: runs = [], isLoading: runsLoading } = overnightQuery;
  const { data: schedules = [] } = schedulesQuery;
  const { data: ambient } = ambientQuery;
  const activeQuery = activeTab === "overnight" ? overnightQuery
    : activeTab === "schedules" ? schedulesQuery
    : activeTab === "ambient" ? ambientQuery : undefined;
  if (runsLoading && runs.length === 0) return <AutomationsSkeleton />;

  const runningCount = runs.filter((r) => r.status === "running").length;
  const enabledSchedulesCount = schedules.filter((s) => s.enabled).length;
  const pendingAmbientCount = (ambient?.approvals ?? []).filter(
    (a) => a.status === "pending",
  ).length;

  return (
    <div
      data-testid="automations-view"
      className={cn(
        "h-full w-full overflow-x-hidden overflow-y-auto bg-canvas @container/automations",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-5 px-3.5 pt-5 pb-8 @min-[520px]/automations:px-[26px]">
        {/* Page Header */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="m-0 text-xl font-semibold tracking-[-0.02em] text-ink">
              Automations
            </h1>
            <p className="mt-1 max-w-[66ch] text-xs text-muted-ink">
              Unattended overnight missions, cron schedules, autonomous ambient
              cycles, and quality gates powered by{" "}
              <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-body">
                rayucode-overnight-core
              </code>
              .
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              data-testid="automations-live-swarm-btn"
              onClick={() => setActiveRoute("swarm")}
            >
              <Network className="size-3.5" aria-hidden="true" />
              <span>Live Swarm</span>
            </Button>
          </div>
        </header>

        {activeQuery?.isError && (
          <div role="alert" className="flex items-center gap-2 text-sm text-muted-ink">
            {activeQuery.data ? "Showing last known automation state." : "Could not load automation state."}
            <Button type="button" variant="ghost" size="sm" onClick={() => void activeQuery.refetch()}>Retry</Button>
          </div>
        )}

        {/* 4-Tab Radix Strip (horizontal scroll-safe in Compact Sidebar <560px) */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as AutomationsTabId)}
          className="w-full"
        >
          <div className="overflow-x-auto pb-1">
            <TabsList className="w-fit min-w-max">
              <TabsTrigger
                value="overnight"
                data-testid="automations-tab-overnight"
              >
                <Moon className="size-3.5" aria-hidden="true" />
                <span>Overnight</span>
                {runningCount > 0 && (
                  <Badge variant="brand" className="px-1.5 py-0 text-[10px]">
                    {runningCount}
                  </Badge>
                )}
              </TabsTrigger>

              <TabsTrigger
                value="schedules"
                data-testid="automations-tab-schedules"
              >
                <CalendarClock className="size-3.5" aria-hidden="true" />
                <span>Schedules</span>
                {enabledSchedulesCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="px-1.5 py-0 font-mono text-[10px]"
                  >
                    {enabledSchedulesCount}
                  </Badge>
                )}
              </TabsTrigger>

              <TabsTrigger
                value="ambient"
                data-testid="automations-tab-ambient"
              >
                <Radar className="size-3.5" aria-hidden="true" />
                <span>Ambient</span>
                {pendingAmbientCount > 0 && (
                  <Badge
                    variant="warn"
                    className="px-1.5 py-0 font-mono text-[10px]"
                  >
                    {pendingAmbientCount}
                  </Badge>
                )}
              </TabsTrigger>

              <TabsTrigger
                value="quality"
                data-testid="automations-tab-quality"
              >
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                <span>Quality &amp; Reports</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overnight" className="mt-3">
            <OvernightTab />
          </TabsContent>

          <TabsContent value="schedules" className="mt-3">
            <SchedulesTab />
          </TabsContent>

          <TabsContent value="ambient" className="mt-3">
            <AmbientTab />
          </TabsContent>

          <TabsContent value="quality" className="mt-3">
            <QualityReportsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export function AutomationsView(props: AutomationsViewProps) {
  return (
    <SectionErrorBoundary title="Automations">
      <React.Suspense fallback={<AutomationsSkeleton />}>
        <AutomationsViewContent {...props} />
      </React.Suspense>
    </SectionErrorBoundary>
  );
}
