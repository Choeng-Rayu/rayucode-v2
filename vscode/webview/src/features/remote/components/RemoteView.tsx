import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { RemoteSkeleton } from "@/components/ui/page-skeletons";
import { NavGlyph, RunStatusPulse } from "@/components/ui/rayu-symbols";
import { SectionErrorBoundary } from "@/components/ui/section-error-boundary";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { useRemote, type RemoteTopTabId } from "../hooks/useRemote";
import { CloudGatewayTab } from "./CloudGatewayTab";
import { TelegramTab } from "./TelegramTab";

export interface RemoteViewProps {
  className?: string;
}

export function RemoteView({ className }: RemoteViewProps) {
  const {
    activeTab,
    setActiveTab,
    setupMode,
    setSetupMode,
    feedbackBanner,
    telegram,
    infra,
    sessions,
    isLoading,
    isError,
    error,
    refetchAll,
    activeSessionId,
    navigateToSettings,
    copyToClipboard,
    openExternalUrl,
    linkHosted,
    isLinkingHosted,
    hostedError,
    linkBotfather,
    isLinkingBotfather,
    botfatherError,
    disconnectTelegram,
    isDisconnectingTelegram,
    sendTestPing,
    isPingingTelegram,
    driveActiveSession,
    isDrivingSession,
    decideApproval,
    isDecidingApproval,
    setRemoteUninstall,
    isTogglingUninstall,
    toggleGateway,
    isTogglingGateway,
    pairGateway,
    isPairingGateway,
    revokeDevice,
    isRevokingDevice,
    moveToCloud,
    returnLocal,
    attachRemote,
    syncCloudEnv,
    isSyncingCloud,
  } = useRemote();

  if (isLoading && (!telegram || !infra)) {
    return <RemoteSkeleton />;
  }

  if (isError || !telegram || !infra) {
    return (
      <div className="mx-auto w-full max-w-[940px] px-6 py-10">
        <ErrorState
          title="Unable to load Remote Access"
          description={
            error instanceof Error
              ? error.message
              : "Failed to fetch Telegram bridge, Cloud sessions, and WebSocket Gateway status."
          }
          onRetry={refetchAll}
        />
      </div>
    );
  }

  const isAnyRemoteActive =
    (telegram.linked && telegram.daemonOnline) ||
    infra.gateway.enabled ||
    infra.sessions.length > 0;

  return (
    <SectionErrorBoundary title="Remote Access Error">
      <div
        data-slot="remote-view"
        data-testid="remote-view"
        className={cn(
          "h-full w-full flex-1 overflow-x-hidden overflow-y-auto bg-canvas @container/remote",
          className,
        )}
      >
        <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-3.5 pt-5 pb-16 @min-[520px]/remote:px-6 @min-[720px]/remote:px-10">
          {/* Page Header */}
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <NavGlyph icon="remote" className="text-brand-text" />
                <h1 className="m-0 text-xl font-semibold tracking-[-0.02em] text-ink">
                  Remote Access
                </h1>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-pane px-2.5 py-0.5 text-[11px] font-medium text-body">
                  <RunStatusPulse
                    status={isAnyRemoteActive ? "running" : "idle"}
                  />
                  <span>
                    {isAnyRemoteActive ? "Bridge Ready" : "Standby"}
                  </span>
                </span>
              </div>
              <p className="mt-1 max-w-[66ch] text-xs text-muted-ink">
                Drive RayuCode sessions from Telegram, pair mobile devices over
                the local :7643 WebSocket Gateway, or hand off active sessions
                to Rayu Cloud and SSH remote targets.
              </p>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={refetchAll}
              data-testid="remote-refresh-btn"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              <span>Refresh</span>
            </Button>
          </header>

          {feedbackBanner && (
            <div
              data-testid="remote-feedback-banner"
              role={feedbackBanner.kind === "error" ? "alert" : "status"}
              className={cn(
                "rounded-xl border px-4 py-2.5 text-xs",
                feedbackBanner.kind === "error"
                  ? "border-danger/30 bg-danger-soft text-danger"
                  : "border-brand/30 bg-brand-soft text-ink",
              )}
            >
              {feedbackBanner.text}
            </div>
          )}

          {/* Top-Level 2 Tabs: Telegram Bot | Cloud, SSH & Gateway */}
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as RemoteTopTabId)}
            className="gap-5"
          >
            <div className="max-w-full overflow-x-auto pb-0.5">
              <TabsList
                className="w-fit min-w-max"
                aria-label="Remote access destination"
              >
                <TabsTrigger
                  value="telegram"
                  onClick={() => setActiveTab("telegram")}
                  data-testid="remote-tab-telegram"
                >
                  Telegram Bot
                </TabsTrigger>
                <TabsTrigger
                  value="cloud-gateway"
                  onClick={() => setActiveTab("cloud-gateway")}
                  data-testid="remote-tab-cloud-gateway"
                >
                  Cloud, SSH &amp; Mobile Gateway
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="telegram">
              <TelegramTab
                telegram={telegram}
                sessions={sessions}
                activeSessionId={activeSessionId}
                setupMode={setupMode}
                onSetupModeChange={setSetupMode}
                onLinkHosted={linkHosted}
                isLinkingHosted={isLinkingHosted}
                hostedError={hostedError}
                onLinkBotfather={linkBotfather}
                isLinkingBotfather={isLinkingBotfather}
                botfatherError={botfatherError}
                onDisconnect={disconnectTelegram}
                isDisconnecting={isDisconnectingTelegram}
                onSendTestPing={sendTestPing}
                isPinging={isPingingTelegram}
                onDriveActiveSession={driveActiveSession}
                isDrivingSession={isDrivingSession}
                onDecideApproval={decideApproval}
                isDecidingApproval={isDecidingApproval}
                onSetRemoteUninstall={setRemoteUninstall}
                isTogglingUninstall={isTogglingUninstall}
                onCopy={copyToClipboard}
                onOpenExternal={openExternalUrl}
              />
            </TabsContent>

            <TabsContent value="cloud-gateway">
              <CloudGatewayTab
                infra={infra}
                activeSessionId={activeSessionId}
                onToggleGateway={toggleGateway}
                isTogglingGateway={isTogglingGateway}
                onPairGateway={pairGateway}
                isPairingGateway={isPairingGateway}
                onRevokeDevice={revokeDevice}
                isRevokingDevice={isRevokingDevice}
                onMoveToCloud={moveToCloud}
                onReturnLocal={returnLocal}
                onAttachRemote={attachRemote}
                onSyncCloudEnv={syncCloudEnv}
                isSyncingCloud={isSyncingCloud}
                onCopy={copyToClipboard}
                onOpenSettings={navigateToSettings}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </SectionErrorBoundary>
  );
}
