import * as React from "react";
import {
  Activity,
  ArrowLeft,
  Keyboard,
  PanelLeft,
  Search,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Sun,
  UserCircle,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { SettingsSkeleton } from "@/components/ui/page-skeletons";
import { RunStatusPulse } from "@/components/ui/rayu-symbols";
import { SectionErrorBoundary } from "@/components/ui/section-error-boundary";
import { useShellFormFactor } from "@/features/shell";
import { useAppStore } from "@/lib/app-store";
import { cn } from "@/lib/utils";

import {
  SETTINGS_SECTIONS,
  useSettings,
  type SettingsNavGroup,
  type SettingsSectionId,
} from "../hooks/useSettings";
import { AccountProvidersSection } from "./AccountProvidersSection";
import { AppearanceSection } from "./AppearanceSection";
import { FeaturesVoiceSection } from "./FeaturesVoiceSection";
import { ModelsAgentsSection } from "./ModelsAgentsSection";
import { RuntimeDoctorSection } from "./RuntimeDoctorSection";
import { SafetyHooksSection } from "./SafetyHooksSection";
import { ShortcutsSection } from "./ShortcutsSection";

export interface SettingsViewProps {
  initialSection?: SettingsSectionId;
  className?: string;
}

const SECTION_ICONS: Record<
  SettingsSectionId,
  React.ComponentType<{ className?: string }>
> = {
  account: UserCircle,
  appearance: Sun,
  models: SlidersHorizontal,
  features: Sparkles,
  safety: Shield,
  runtime: Wrench,
  shortcuts: Keyboard,
};

const NAV_GROUPS: ReadonlyArray<SettingsNavGroup> = [
  "Account",
  "App",
  "System",
];

export function SettingsView({
  initialSection = "account",
  className,
}: SettingsViewProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const { formFactor } = useShellFormFactor(containerRef);
  const isCompact = formFactor === "compact";
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);

  const {
    activeSection,
    setActiveSection,
    sidebarCollapsed,
    setSidebarCollapsed,
    searchQuery,
    setSearchQuery,
    filteredSections,
    statusMessage,
    goBackToWorkspace,
    account,
    analytics,
    analyticsRange,
    setAnalyticsRange,
    analyticsGroupBy,
    setAnalyticsGroupBy,
    providers,
    models,
    features,
    voice,
    telemetry,
    hooksData,
    runtime,
    daemonStatus,
    shortcuts,
    defaultPermissionMode,
    doctorResults,
    selfDevOutput,
    isLoading,
    isError,
    refetchAll,
    refreshAccount,
    isRefreshingAccount,
    signInBrowser,
    cancelSignIn,
    signInApiKey,
    completeCallback,
    signOut,
    isSigningOut,
    setBypassPacing,
    setProviderApiKey,
    clearProviderApiKey,
    logoutProvider,
    refreshModels,
    isRefreshingModels,
    setDefaultModel,
    setDefaultEffort,
    setFastTier,
    setCacheTtl,
    setRoleOverride,
    setFeatureFlag,
    updateVoice,
    setPermissionMode,
    openHooksConfig,
    pingDaemon,
    isPingingDaemon,
    reloadDaemonAndBridge,
    isReloadingDaemon,
    reconnectDaemon,
    openOutputLog,
    updateRuntime,
    runDoctor,
    isRunningDoctor,
    runSelfDev,
    isRunningSelfDev,
    setTelemetry,
    submitFeedback,
    openKeybindings,
  } = useSettings(initialSection);

  // Auto-select first matching section when filtering
  React.useEffect(() => {
    if (
      filteredSections.length > 0 &&
      !filteredSections.some((s) => s.id === activeSection)
    ) {
      const first = filteredSections[0];
      if (first) setActiveSection(first.id);
    }
  }, [activeSection, filteredSections, setActiveSection]);

  if (isLoading && (!account || !models || !features || !voice || !telemetry)) {
    return <SettingsSkeleton />;
  }

  if (isError || !account || !models || !features || !voice || !telemetry) {
    return (
      <div className="mx-auto max-w-[760px] p-6">
        <ErrorState
          title="Unable to load settings"
          description="Failed to read configuration from the local RayuCode daemon."
          onRetry={refetchAll}
        />
      </div>
    );
  }

  const isDaemonConnected = daemonStatus.state === "connected";

  const showSideRail = !isCompact && !sidebarCollapsed;

  return (
    <SectionErrorBoundary title="Settings Error">
      <div
        ref={containerRef}
        data-slot="settings-view"
        data-testid="settings-view"
        data-form-factor={formFactor}
        className={cn(
          "flex h-full min-h-0 w-full flex-1 bg-chrome",
          showSideRail ? "flex-row" : "flex-col",
          className,
        )}
      >
        {/* Left Collapsible Category Navigation Rail (Wide & Medium) */}
        {showSideRail && (
          <aside
            aria-label="Settings navigation"
            data-testid="settings-left-rail"
            className={cn(
              "flex shrink-0 flex-col border-r border-hairline bg-chrome select-none",
              formFactor === "medium" ? "w-[208px]" : "w-[248px]",
            )}
          >
              <div className="flex h-11 items-center justify-between px-3.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Collapse settings sidebar"
                  data-testid="settings-collapse-rail-btn"
                  onClick={() => setSidebarCollapsed(true)}
                >
                  <PanelLeft className="size-4" />
                </Button>
                <span className="text-xs font-medium text-muted-ink">
                  Settings
                </span>
              </div>

              <div className="px-2.5 pb-2">
                <button
                  type="button"
                  data-testid="settings-back-btn"
                  onClick={goBackToWorkspace}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-body transition-colors hover:bg-hover hover:text-ink"
                >
                  <ArrowLeft className="size-3.5 text-muted-ink" />
                  <span>Back to workspace</span>
                </button>
              </div>

              <div className="relative px-3 pb-2.5">
                <Search
                  className="pointer-events-none absolute top-2.5 left-5.5 size-3.5 text-muted-ink"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter settings..."
                  aria-label="Filter settings"
                  data-testid="settings-search-input"
                  className="h-8 w-full rounded-[10px] border border-hairline bg-inset pr-3 pl-8 text-xs text-ink placeholder:text-muted-ink focus:border-hairline-strong focus:outline-none"
                />
              </div>

              <nav
                aria-label="Settings categories"
                className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4"
              >
                {NAV_GROUPS.map((group) => {
                  const items = filteredSections.filter(
                    (s) => s.group === group,
                  );
                  if (items.length === 0) return null;
                  return (
                    <div key={group} className="mb-3.5">
                      <div className="px-2.5 pt-1 pb-1.5 text-[11px] font-medium text-muted-ink">
                        {group}
                      </div>
                      <div className="flex flex-col gap-0.5">
                        {items.map((sec) => {
                          const Icon = SECTION_ICONS[sec.id];
                          const isActive = activeSection === sec.id;
                          return (
                            <button
                              key={sec.id}
                              type="button"
                              data-testid={`settings-nav-${sec.id}`}
                              aria-current={isActive ? "page" : undefined}
                              onClick={() => setActiveSection(sec.id)}
                              className={cn(
                                "flex w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-left text-xs transition-colors",
                                isActive
                                  ? "bg-active font-medium text-ink"
                                  : "font-normal text-body hover:bg-hover hover:text-ink",
                              )}
                            >
                              <Icon
                                className={cn(
                                  "size-3.5 shrink-0",
                                  isActive ? "text-brand-text" : "text-muted-ink",
                                )}
                              />
                              <span className="truncate">{sec.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </nav>

              {/* Bottom Live Daemon Health Ping Pill */}
              <div className="border-t border-hairline p-2.5">
                <button
                  type="button"
                  onClick={() => void pingDaemon()}
                  disabled={isPingingDaemon}
                  data-testid="settings-daemon-health-pill"
                  className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-hairline bg-pane px-2.5 py-1.5 text-[11px] text-body transition-colors hover:border-premium hover:text-ink"
                >
                  <span className="flex items-center gap-1.5">
                    <RunStatusPulse
                      status={isDaemonConnected ? "running" : "warn"}
                    />
                    <span className="font-medium text-ink">
                      Daemon {isDaemonConnected ? "Healthy" : "Offline"}
                    </span>
                  </span>
                  <span className="font-mono text-[10.5px] text-brand-text tabular-nums">
                    {daemonStatus.latencyMs ?? 4} ms
                  </span>
                </button>
              </div>
            </aside>
          )}

          {/* Main Content Stage */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
            {/* Top Bar for Compact Sidebar (<560px) or Collapsed Rail */}
            {(isCompact || sidebarCollapsed) && (
              <header
                data-testid="settings-compact-header"
                className="flex flex-col gap-2 border-b border-hairline bg-chrome px-3.5 py-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {!isCompact && sidebarCollapsed && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Expand settings sidebar"
                        data-testid="settings-expand-rail-btn"
                        onClick={() => setSidebarCollapsed(false)}
                      >
                        <PanelLeft className="size-3.5" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      data-testid="settings-back-btn"
                      onClick={goBackToWorkspace}
                    >
                      <ArrowLeft className="size-3.5" />
                      <span>Back</span>
                    </Button>
                  </div>

                  <div className="relative min-w-0 flex-1 sm:min-w-[160px]">
                    <Search
                      className="pointer-events-none absolute top-1.5 left-2.5 size-3 text-muted-ink"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter settings..."
                      aria-label="Filter settings"
                      data-testid="settings-search-input"
                      className="h-6 w-full rounded-md border border-hairline bg-inset pr-2 pl-7 text-[11px] text-ink"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => void pingDaemon()}
                    data-testid="settings-daemon-health-pill"
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-hairline bg-pane px-2 py-0.5 font-mono text-[10.5px] text-ink"
                  >
                    <Activity className="size-3 text-brand-text" />
                    <span>{daemonStatus.latencyMs ?? 4} ms</span>
                  </button>
                </div>

                {/* Horizontal Category Strip for Compact Mode */}
                <div
                  role="tablist"
                  aria-label="Settings categories"
                  className="flex gap-1 overflow-x-auto pb-0.5"
                >
                  {SETTINGS_SECTIONS.map((sec) => (
                    <button
                      key={sec.id}
                      type="button"
                      role="tab"
                      aria-selected={activeSection === sec.id}
                      data-testid={`settings-nav-${sec.id}`}
                      onClick={() => setActiveSection(sec.id)}
                      className={cn(
                        "shrink-0 cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-medium whitespace-nowrap",
                        activeSection === sec.id
                          ? "bg-active text-ink"
                          : "text-muted-ink hover:text-ink",
                      )}
                    >
                      {sec.label}
                    </button>
                  ))}
                </div>
              </header>
            )}

            {/* Scrollable Category Content */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto flex w-full max-w-[820px] flex-col gap-5 px-5 pt-6 pb-20 md:px-8">
                {statusMessage && (
                  <div
                    data-testid="settings-status-banner"
                    className="rounded-xl border border-brand/30 bg-brand-soft px-4 py-2 text-xs text-ink"
                  >
                    {statusMessage}
                  </div>
                )}

                {activeSection === "account" && (
                  <AccountProvidersSection
                    account={account}
                    analytics={analytics}
                    analyticsRange={analyticsRange}
                    onAnalyticsRangeChange={setAnalyticsRange}
                    analyticsGroupBy={analyticsGroupBy}
                    onAnalyticsGroupByChange={setAnalyticsGroupBy}
                    providers={providers}
                    onRefreshAccount={refreshAccount}
                    isRefreshingAccount={isRefreshingAccount}
                    onSignInBrowser={signInBrowser}
                    onCancelSignIn={cancelSignIn}
                    onSignInApiKey={signInApiKey}
                    onCompleteCallback={completeCallback}
                    onSignOut={signOut}
                    isSigningOut={isSigningOut}
                    onSetBypassPacing={setBypassPacing}
                    onSetProviderApiKey={setProviderApiKey}
                    onClearProviderApiKey={clearProviderApiKey}
                    onLogoutProvider={logoutProvider}
                    onRefreshModels={refreshModels}
                    isRefreshingModels={isRefreshingModels}
                  />
                )}

                {activeSection === "appearance" && <AppearanceSection />}

                {activeSection === "models" && (
                  <ModelsAgentsSection
                    defaultModel={models.defaultModel ?? "rayu:claude-sonnet-4-5"}
                    defaultEffort={models.defaultEffort}
                    serviceTier={models.serviceTier}
                    cacheTtl={models.cacheTtl}
                    roleOverrides={models.roleOverrides}
                    profiles={models.profiles}
                    subagentModel={models.subagentModel}
                    swarmAllowlist={models.swarmAllowlist}
                    routes={models.routes}
                    onSelectDefaultModel={setDefaultModel}
                    onSelectDefaultEffort={setDefaultEffort}
                    onSelectServiceTier={setFastTier}
                    onSelectCacheTtl={setCacheTtl}
                    onSetRoleOverride={setRoleOverride}
                    onOpenAgentsStudio={() => setActiveRoute("agents")}
                    onRefreshModels={refreshModels}
                    isRefreshingModels={isRefreshingModels}
                  />
                )}

                {activeSection === "features" && (
                  <FeaturesVoiceSection
                    features={features}
                    voice={voice}
                    onSetFeatureFlag={setFeatureFlag}
                    onUpdateVoice={updateVoice}
                  />
                )}

                {activeSection === "safety" && (
                  <SafetyHooksSection
                    defaultPermissionMode={defaultPermissionMode}
                    onSelectPermissionMode={setPermissionMode}
                    hooks={hooksData?.hooks ?? []}
                    configPath={hooksData?.configPath}
                    onOpenHooksConfig={openHooksConfig}
                  />
                )}

                {activeSection === "runtime" && (
                  <RuntimeDoctorSection
                    daemonStatus={daemonStatus}
                    runtime={
                      runtime ?? {
                        socketPath:
                          daemonStatus.socketPath ??
                          "/run/user/1000/rayu-daemon.sock",
                        binaryPath: "~/.local/bin/rayu",
                        autoStart: true,
                        transport: models.transport,
                      }
                    }
                    telemetry={telemetry}
                    doctorResults={doctorResults}
                    selfDevOutput={selfDevOutput}
                    onPingDaemon={pingDaemon}
                    isPingingDaemon={isPingingDaemon}
                    onReloadDaemonAndBridge={reloadDaemonAndBridge}
                    isReloadingDaemon={isReloadingDaemon}
                    onReconnectDaemon={reconnectDaemon}
                    onOpenOutputLog={openOutputLog}
                    onUpdateRuntime={updateRuntime}
                    onRunDoctor={runDoctor}
                    isRunningDoctor={isRunningDoctor}
                    onRunSelfDev={runSelfDev}
                    isRunningSelfDev={isRunningSelfDev}
                    onSetTelemetry={setTelemetry}
                    onSubmitFeedback={submitFeedback}
                  />
                )}

                {activeSection === "shortcuts" && (
                  <ShortcutsSection
                    shortcuts={shortcuts}
                    onOpenKeybindings={openKeybindings}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
    </SectionErrorBoundary>
  );
}
