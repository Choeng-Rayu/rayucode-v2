import {
  ArrowLeftRight,
  Cloud,
  Copy,
  QrCode,
  RefreshCw,
  Server,
  Smartphone,
  Trash2,
  Wifi,
} from "lucide-react";
import type { RemoteInfraStatusView } from "@shared/vscodeProtocol";

import { Button } from "@/components/ui/button";
import { RunStatusPulse } from "@/components/ui/rayu-symbols";
import { cn, formatRelativeTime } from "@/lib/utils";

import { CLOUD_26_OPERATIONS } from "../hooks/useRemote";
import { PairingQrMatrix } from "./PairingQrMatrix";

export interface CloudGatewayTabProps {
  infra: RemoteInfraStatusView;
  activeSessionId: string;
  onToggleGateway: (enabled: boolean) => Promise<unknown>;
  isTogglingGateway: boolean;
  onPairGateway: () => Promise<unknown>;
  isPairingGateway: boolean;
  onRevokeDevice: (deviceId: string) => Promise<unknown>;
  isRevokingDevice: boolean;
  onMoveToCloud: (sessionId?: string) => Promise<unknown>;
  onReturnLocal: (remoteSessionId: string) => Promise<unknown>;
  onAttachRemote: (remoteSessionId: string) => Promise<unknown>;
  onSyncCloudEnv: () => Promise<unknown>;
  isSyncingCloud: boolean;
  onCopy: (text: string, label: string) => void;
  onOpenSettings: () => void;
}

export function CloudGatewayTab({
  infra,
  activeSessionId,
  onToggleGateway,
  isTogglingGateway,
  onPairGateway,
  isPairingGateway,
  onRevokeDevice,
  isRevokingDevice,
  onMoveToCloud,
  onReturnLocal,
  onAttachRemote,
  onSyncCloudEnv,
  isSyncingCloud,
  onCopy,
  onOpenSettings,
}: CloudGatewayTabProps) {
  const { gateway, sessions, sshHosts } = infra;
  const bindAddress = `${gateway.bindAddr ?? "127.0.0.1"}:${gateway.port ?? 7643}`;
  const dialAddress = gateway.dialAddress ?? `ws://${bindAddress}`;
  const pairingQr = gateway.pairingQr;

  return (
    <div data-testid="cloud-gateway-tab" className="flex flex-col gap-6">
      {/* Section A: :7643 Local WebSocket Mobile Gateway */}
      <section className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wifi className="size-4 text-brand-text" aria-hidden="true" />
            <h2 className="m-0 text-sm font-semibold tracking-[-0.015em] text-ink">
              Local WebSocket Mobile Gateway (:7643)
            </h2>
            <span
              data-testid="gateway-status-badge"
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                gateway.enabled
                  ? "bg-brand-soft text-brand-text"
                  : "bg-raised text-muted-ink",
              )}
            >
              {gateway.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={isPairingGateway}
              onClick={() => void onPairGateway()}
              data-testid="gateway-pair-btn"
            >
              <QrCode className="size-3.5" aria-hidden="true" />
              <span>Generate 5-Min Pairing Invite</span>
            </Button>

            <Button
              type="button"
              variant={gateway.enabled ? "destructive" : "primary"}
              size="sm"
              disabled={isTogglingGateway}
              onClick={() => void onToggleGateway(!gateway.enabled)}
              data-testid="gateway-toggle-btn"
            >
              <span>{gateway.enabled ? "Stop Gateway" : "Start Gateway"}</span>
            </Button>
          </div>
        </div>

        {/* Gateway Status & Pairing QR Card */}
        <div className="rayu-card-bevel overflow-hidden rounded-[14px] border border-premium bg-pane p-4">
          <div className="grid grid-cols-1 gap-3 border-b border-hairline-soft pb-3.5 text-xs sm:grid-cols-3">
            <div>
              <div className="text-[11px] text-muted-ink">Bind address</div>
              <code
                data-testid="gateway-bind-address"
                className="mt-0.5 block font-mono text-xs text-ink"
              >
                {bindAddress}
              </code>
            </div>
            <div>
              <div className="text-[11px] text-muted-ink">Dial endpoint</div>
              <code
                data-testid="gateway-dial-address"
                className="mt-0.5 block font-mono text-xs text-brand-text"
              >
                {dialAddress}
              </code>
            </div>
            <div>
              <div className="text-[11px] text-muted-ink">Paired devices</div>
              <div className="mt-0.5 font-mono text-xs text-ink tabular-nums">
                {gateway.devices.length} active device(s)
              </div>
            </div>
          </div>

          {gateway.restartRequired && (
            <div
              data-testid="gateway-restart-notice"
              className="mt-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn"
            >
              Gateway listener state updated. Reload daemon when convenient to
              rebind socket listeners without interrupting active turns.
            </div>
          )}

          {pairingQr && (
            <div className="mt-4 flex flex-col items-center gap-5 md:flex-row md:items-start">
              <PairingQrMatrix
                value={pairingQr.uri}
                label="WebSocket Gateway pairing QR matrix"
                testId="gateway-qr-matrix"
              />

              <div className="min-w-0 flex-1 text-xs">
                <div className="font-medium text-ink">
                  Mobile &amp; Tablet WebSocket Pairing Invite
                </div>
                <p className="mt-1 text-muted-ink">
                  Scan this QR matrix in the Rayu Mobile companion app or enter
                  the 6-digit invite code below. Valid for 5 minutes.
                </p>

                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-hairline bg-inset px-3 py-2">
                    <div className="text-[10.5px] text-muted-ink">
                      6-digit invite code
                    </div>
                    <div
                      data-testid="gateway-pairing-code"
                      className="mt-0.5 font-mono text-sm font-semibold tracking-wider text-ink tabular-nums"
                    >
                      {pairingQr.code}
                    </div>
                  </div>
                  <div className="rounded-lg border border-hairline bg-inset px-3 py-2">
                    <div className="text-[10.5px] text-muted-ink">
                      Pairing URI
                    </div>
                    <div
                      data-testid="gateway-pairing-uri"
                      className="mt-0.5 truncate font-mono text-xs text-brand-text"
                    >
                      {pairingQr.uri}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="default"
                    size="xs"
                    onClick={() => onCopy(pairingQr.code, "gateway invite code")}
                    data-testid="gateway-copy-code-btn"
                  >
                    <Copy className="size-3" aria-hidden="true" />
                    <span>Copy Invite Code</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => onCopy(pairingQr.uri, "gateway pairing URI")}
                    data-testid="gateway-copy-uri-btn"
                  >
                    <Copy className="size-3" aria-hidden="true" />
                    <span>Copy URI</span>
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Paired Devices List */}
          <div className="mt-4 border-t border-hairline-soft pt-3.5">
            <div className="mb-2 flex items-center justify-between text-xs font-medium text-ink">
              <span>Paired Mobile &amp; Companion Devices</span>
              <span className="font-mono text-[11px] text-muted-ink tabular-nums">
                {gateway.devices.length} paired
              </span>
            </div>

            {gateway.devices.length === 0 ? (
              <div className="rounded-lg border border-hairline bg-inset px-3 py-4 text-center text-xs text-muted-ink">
                No paired mobile devices yet.
              </div>
            ) : (
              <div
                data-testid="gateway-devices-list"
                className="divide-y divide-hairline-soft rounded-lg border border-hairline bg-inset"
              >
                {gateway.devices.map((device) => (
                  <div
                    key={device.id}
                    data-testid={`gateway-device-row-${device.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <Smartphone
                        className="size-4 text-brand-text"
                        aria-hidden="true"
                      />
                      <div>
                        <div className="font-medium text-ink">{device.name}</div>
                        <div className="font-mono text-[10.5px] text-muted-ink">
                          {device.id} · Paired{" "}
                          {formatRelativeTime(device.pairedAtMs)}
                          {device.lastSeenAtMs
                            ? ` · Last seen ${formatRelativeTime(device.lastSeenAtMs)}`
                            : ""}
                        </div>
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="destructive"
                      size="xs"
                      disabled={isRevokingDevice}
                      onClick={() => void onRevokeDevice(device.id)}
                      data-testid={`gateway-revoke-${device.id}`}
                    >
                      <Trash2 className="size-3" aria-hidden="true" />
                      <span>Revoke</span>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Section B: Cloud 26-Op Workspace Sessions & SSH Remote Targets */}
      <section className="flex flex-col gap-3.5 border-t border-hairline pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Cloud className="size-4 text-brand-text" aria-hidden="true" />
            <h2 className="m-0 text-sm font-semibold tracking-[-0.015em] text-ink">
              Cloud 26-Op Workspaces &amp; SSH Remote Hosts
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={isSyncingCloud}
              onClick={() => void onSyncCloudEnv()}
              data-testid="cloud-sync-env-btn"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              <span>Sync Cloud Environment</span>
            </Button>

            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={isSyncingCloud}
              onClick={() => void onMoveToCloud(activeSessionId)}
              data-testid="cloud-move-session-btn"
            >
              <ArrowLeftRight className="size-3.5" aria-hidden="true" />
              <span>Move Session to Cloud</span>
            </Button>
          </div>
        </div>

        {/* SSH Remote Host Targets */}
        <div className="rayu-card-bevel rounded-[14px] border border-premium bg-pane p-4">
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-ink">
            <div className="flex items-center gap-2">
              <Server className="size-3.5 text-muted-ink" aria-hidden="true" />
              <span>SSH Remote Host Targets</span>
            </div>
            <span className="font-mono text-[11px] text-muted-ink tabular-nums">
              {sshHosts.length} configured
            </span>
          </div>

          {sshHosts.length === 0 ? (
            <div className="mt-2 flex items-center justify-between text-xs text-muted-ink">
              <span>No SSH hosts configured in ~/.ssh/config or rayu.</span>
              <Button
                type="button"
                variant="link"
                size="xs"
                onClick={onOpenSettings}
              >
                Settings -&gt; Account &amp; Providers
              </Button>
            </div>
          ) : (
            <div
              data-testid="ssh-hosts-list"
              className="mt-2.5 flex flex-wrap gap-2"
            >
              {sshHosts.map((host) => (
                <div
                  key={host}
                  data-testid={`ssh-host-pill-${host}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-hairline bg-inset px-3 py-1.5 font-mono text-xs text-ink"
                >
                  <RunStatusPulse status="running" />
                  <span>ssh://{host}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cloud & SSH Remote Sessions Table */}
        <div
          data-testid="remote-sessions-list"
          className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-[14px] border border-premium bg-pane"
        >
          {sessions.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-ink">
              No active remote Cloud or SSH sessions. Click &ldquo;Move Session
              to Cloud&rdquo; to hand off your active transcript.
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                data-testid={`remote-session-row-${session.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
                    <span className="rounded-full border border-hairline bg-raised px-2 py-0.5 font-mono text-[10.5px] uppercase text-brand-text">
                      {session.kind}
                    </span>
                    <span>{session.label}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                        session.status === "running"
                          ? "bg-brand-soft text-brand-text"
                          : "bg-raised text-muted-ink",
                      )}
                    >
                      {session.status}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-muted-ink">
                    {session.id} · Host: {session.host ?? "rayu-cloud"} ·{" "}
                    {session.workingDir ?? "/workspace"}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="default"
                    size="xs"
                    disabled={isSyncingCloud}
                    onClick={() => void onAttachRemote(session.id)}
                    data-testid={`remote-attach-${session.id}`}
                  >
                    <span>Attach Remote Session</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={isSyncingCloud}
                    onClick={() => void onReturnLocal(session.id)}
                    data-testid={`remote-return-${session.id}`}
                  >
                    <span>Return Session Locally</span>
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 26-Op Rust Cloud Engine Capability Summary */}
        <div className="rounded-[12px] border border-hairline bg-inset p-3">
          <div className="flex items-center justify-between text-[11px] font-medium text-muted-ink">
            <span>
              Rust Cloud Engine Coverage ({CLOUD_26_OPERATIONS.length} operations
              via rayu cloud &amp; RuntimeCommand::Remote)
            </span>
          </div>
          <div
            data-testid="cloud-26-ops-grid"
            className="mt-2 flex flex-wrap gap-1.5"
          >
            {CLOUD_26_OPERATIONS.map((op) => (
              <span
                key={op}
                className="rounded border border-hairline-soft bg-pane px-1.5 py-0.5 font-mono text-[10px] text-body"
              >
                {op}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
