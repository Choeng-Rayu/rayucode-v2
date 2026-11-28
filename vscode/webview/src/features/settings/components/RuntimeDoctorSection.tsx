import { operationAvailable } from "@/lib/operation-result";
import { formatDaemonVersionLabel } from "@rayu-dev/rayucode-session-core/client";
import * as React from "react";
import {
  Activity,
  CheckCircle2,
  Download,
  FileText,
  RefreshCw,
  Stethoscope,
  TriangleAlert,
  Wrench,
  XCircle,
} from "lucide-react";
import type {
  DaemonStatusView,
  DoctorCheckView,
  ProviderTransport,
  TelemetryCategory,
  TelemetryConfigView,
} from "@shared/vscodeProtocol";

import { Button } from "@/components/ui/button";
import { RunStatusPulse } from "@/components/ui/rayu-symbols";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface RuntimeDoctorSectionProps {
  daemonStatus: DaemonStatusView;
  runtime: {
    socketPath: string;
    binaryPath: string;
    autoStart: boolean;
    transport: ProviderTransport;
  };
  telemetry: TelemetryConfigView;
  doctorResults: ReadonlyArray<DoctorCheckView>;
  selfDevOutput: string | null;
  onPingDaemon: () => Promise<unknown>;
  isPingingDaemon: boolean;
  onReloadDaemonAndBridge: () => Promise<unknown>;
  isReloadingDaemon: boolean;
  onUpdateEngine?: () => Promise<unknown>;
  isUpdatingEngine?: boolean;
  onReconnectDaemon: () => Promise<unknown>;
  onOpenOutputLog: () => Promise<unknown>;
  onUpdateRuntime: (patch: {
    socketPath?: string;
    binaryPath?: string;
    autoStart?: boolean;
    transport?: ProviderTransport;
  }) => Promise<unknown>;
  onRunDoctor: (scope: "providers" | "auth") => Promise<unknown>;
  isRunningDoctor: boolean;
  onRunSelfDev: (action: "status" | "build" | "reload") => Promise<unknown>;
  isRunningSelfDev: boolean;
  onSetTelemetry: (
    category: TelemetryCategory | "all" | "none",
    enabled?: boolean,
  ) => Promise<unknown>;
  onSubmitFeedback: (input: {
    kind: "bug" | "suggestion" | "usability";
    summary: string;
    details?: string;
  }) => Promise<unknown>;
}

const SIX_TELEMETRY_CATEGORIES: ReadonlyArray<{
  id: TelemetryCategory;
  label: string;
  description: string;
}> = [
  {
    id: "content",
    label: "Prompt & Transcript Content (telemetry.content)",
    description:
      "Share opt-in prompt/completion payloads for quality evaluation (OFF by default)",
  },
  {
    id: "usage",
    label: "Command & Session Usage Counts (telemetry.usage)",
    description: "Aggregate turn counts and session duration metrics",
  },
  {
    id: "crashes",
    label: "Daemon Panic & Crash Reports (telemetry.crashes)",
    description: "Send symbolized Rust backtraces when a worker thread panics",
  },
  {
    id: "features",
    label: "Feature Adoption Signals (telemetry.features)",
    description: "Track which top-level views and tools are active",
  },
  {
    id: "cost",
    label: "Token & KV-Cache Efficiency Metrics (telemetry.cost)",
    description: "Record cache hit ratios and token budget utilization",
  },
  {
    id: "accounts",
    label: "Account & Provider Attribution (telemetry.accounts)",
    description: "Include pseudonymous account identifier in telemetry envelopes",
  },
];

export function RuntimeDoctorSection({
  daemonStatus,
  runtime,
  telemetry,
  doctorResults,
  selfDevOutput,
  onPingDaemon,
  isPingingDaemon,
  onReloadDaemonAndBridge,
  isReloadingDaemon,
  onUpdateEngine,
  isUpdatingEngine,
  onReconnectDaemon,
  onOpenOutputLog,
  onUpdateRuntime,
  onRunDoctor,
  isRunningDoctor,
  onRunSelfDev,
  isRunningSelfDev,
  onSetTelemetry,
  onSubmitFeedback,
}: RuntimeDoctorSectionProps) {
  const [socketPath, setSocketPath] = React.useState(runtime.socketPath);
  const [binaryPath, setBinaryPath] = React.useState(runtime.binaryPath);
  const [feedbackSummary, setFeedbackSummary] = React.useState("");

  React.useEffect(() => {
    setSocketPath(runtime.socketPath);
    setBinaryPath(runtime.binaryPath);
  }, [runtime.binaryPath, runtime.socketPath]);

  const isConnected = daemonStatus.state === "connected";
  const isTransferring =
    daemonStatus.state === "downloading" ||
    (daemonStatus.downloadPhase !== undefined &&
      daemonStatus.downloadPhase !== "starting");

  return (
    <section
      data-testid="settings-section-runtime"
      aria-labelledby="settings-h-runtime"
      className="flex flex-col gap-6"
    >
      <div>
        <h1
          id="settings-h-runtime"
          className="m-0 text-xl font-semibold tracking-[-0.02em] text-ink"
        >
          Runtime, Bridge &amp; Doctor
        </h1>
        <p className="mt-1 text-xs text-muted-ink">
          Inspect live daemon socket health, configure paths, run Provider &amp;
          Auth Doctor diagnostics, trigger Self-Dev builds, and manage the 6
          telemetry privacy toggles.
        </p>
      </div>

      {/* Live Daemon & Bridge Card */}
      <div
        data-testid="runtime-daemon-card"
        className="rayu-card-bevel rounded-xl border border-premium bg-pane p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs">
            <Activity className="size-4 text-brand-text" aria-hidden="true" />
            <span className="font-semibold text-ink">
              rayu shared daemon &amp; api-bridge
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-inset px-2.5 py-0.5 text-[11px] font-medium text-ink">
              <RunStatusPulse status={isConnected ? "running" : "warn"} />
              <span>{daemonStatus.state}</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="default"
              size="xs"
              disabled={isPingingDaemon}
              onClick={() => void onPingDaemon().catch(() => {})}
              data-testid="runtime-ping-btn"
            >
              <span>{isPingingDaemon ? "Pinging..." : "Ping"}</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void onReconnectDaemon().catch(() => {})}
              data-testid="runtime-reconnect-btn"
            >
              <span>Reconnect</span>
            </Button>

            {onUpdateEngine && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={isUpdatingEngine || isTransferring}
                onClick={() => void onUpdateEngine().catch(() => {})}
                data-testid="runtime-update-engine-btn"
              >
                <Download className="size-3" aria-hidden="true" />
                <span>
                  {isTransferring
                    ? `${daemonStatus.state === "connected" ? "Updating" : "Installing"}${daemonStatus.downloadProgress !== undefined ? ` ${daemonStatus.downloadProgress}%` : "..."}`
                    : isUpdatingEngine
                      ? "Checking..."
                      : "Install / Update Engine"}
                </span>
              </Button>
            )}

            <Button
              type="button"
              variant="primary"
              size="xs"
              disabled={isReloadingDaemon}
              onClick={() => void onReloadDaemonAndBridge().catch(() => {})}
              data-testid="reload-daemon-bridge-btn"
            >
              <RefreshCw
                className={cn("size-3", isReloadingDaemon && "animate-spin")}
                aria-hidden="true"
              />
              <span>Reload Daemon &amp; Bridge</span>
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void onOpenOutputLog().catch(() => {})}
              data-testid="runtime-open-log-btn"
            >
              <FileText className="size-3" aria-hidden="true" />
              <span>Open Output Log</span>
            </Button>
          </div>
        </div>

        {isTransferring && (
          <div
            data-testid="runtime-daemon-progress-bar"
            className="mt-3 flex flex-col gap-1.5 rounded-lg border border-warn/30 bg-warn-soft p-2.5 text-xs"
          >
            <div className="flex items-center justify-between gap-2 text-warn">
              <span className="truncate font-medium">
                {daemonStatus.statusMessage ??
                  `Downloading Rayu engine${daemonStatus.downloadVersion ? ` ${daemonStatus.downloadVersion}` : ""} — please wait...`}
              </span>
              {daemonStatus.downloadProgress !== undefined && (
                <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums">
                  {daemonStatus.downloadProgress}%
                </span>
              )}
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-inset"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={daemonStatus.downloadProgress ?? 0}
            >
              <div
                className={cn(
                  "h-full rounded-full bg-brand transition-[width] duration-200",
                  daemonStatus.downloadProgress === undefined && "animate-pulse",
                )}
                style={{
                  width: `${Math.max(6, Math.min(100, daemonStatus.downloadProgress ?? 20))}%`,
                }}
              />
            </div>
          </div>
        )}

        <div className="mt-3.5 grid grid-cols-2 gap-3 border-t border-hairline-soft pt-3 text-xs sm:grid-cols-4">
          <div>
            <div className="text-[11px] text-muted-ink">Daemon version</div>
            <div className="mt-0.5 font-mono text-ink">
              {daemonStatus.version
                ? formatDaemonVersionLabel(daemonStatus.version)
                : isConnected
                  ? "Connected"
                  : "Not connected"}
            </div>
            {(daemonStatus.managedVersion || daemonStatus.binarySource) && (
              <div className="mt-0.5 truncate font-mono text-[10px] text-muted-ink">
                {[
                  daemonStatus.binarySource,
                  daemonStatus.managedVersion,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}
          </div>
          <div>
            <div className="text-[11px] text-muted-ink">Harness protocol</div>
            <div className="mt-0.5 font-mono text-brand-text">
              {daemonStatus.protocolVersion
                ? `v${daemonStatus.protocolVersion}`
                : daemonStatus.state === "connected"
                  ? "v1"
                  : "Offline"}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-muted-ink">Round-trip latency</div>
            <div className="mt-0.5 font-mono text-ink tabular-nums">
              {daemonStatus.latencyMs !== undefined
                ? `${daemonStatus.latencyMs} ms`
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-muted-ink">Daemon PID</div>
            <div className="mt-0.5 font-mono text-ink tabular-nums">
              {daemonStatus.pid !== undefined
                ? daemonStatus.pid
                : isConnected
                  ? "Shared"
                  : "—"}
            </div>
          </div>
        </div>

        {daemonStatus.capabilities.length > 0 && (
          <div className="mt-3 border-t border-hairline-soft pt-3">
            <div className="mb-1.5 text-[11px] text-muted-ink">
              Negotiated Harness capabilities ({daemonStatus.capabilities.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {daemonStatus.capabilities.map((cap) => (
                <span
                  key={cap}
                  className="rounded border border-hairline bg-inset px-1.5 py-0.5 font-mono text-[10px] text-body"
                >
                  {cap}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Socket Path, Binary Path, Auto-Start & Transport */}
      <div className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-xl border border-premium bg-pane text-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <label htmlFor="runtime-socket-path" className="font-medium text-ink">
            Daemon Unix socket path (rayucode.apiSocketPath)
          </label>
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
            <input
              id="runtime-socket-path"
              type="text"
              value={socketPath}
              onChange={(e) => setSocketPath(e.target.value)}
              data-testid="runtime-socket-path-input"
              className="h-7 min-w-0 flex-1 rounded border border-control-border bg-inset px-2 font-mono text-xs text-ink sm:w-[250px] sm:flex-none"
            />
            <Button
              type="button"
              variant="default"
              size="xs"
              onClick={() => void onUpdateRuntime({ socketPath }).catch(() => {})}
              data-testid="runtime-save-socket-btn"
            >
              Save
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <label htmlFor="runtime-binary-path" className="font-medium text-ink">
            Rayu binary path (rayucode.binaryPath)
          </label>
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
            <input
              id="runtime-binary-path"
              type="text"
              value={binaryPath}
              onChange={(e) => setBinaryPath(e.target.value)}
              data-testid="runtime-binary-path-input"
              className="h-7 min-w-0 flex-1 rounded border border-control-border bg-inset px-2 font-mono text-xs text-ink sm:w-[250px] sm:flex-none"
            />
            <Button
              type="button"
              variant="default"
              size="xs"
              onClick={() => void onUpdateRuntime({ binaryPath }).catch(() => {})}
              data-testid="runtime-save-binary-btn"
            >
              Save
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="font-medium text-ink">
              Auto-start shared daemon (rayucode.autoStartBridge)
            </div>
            <div className="mt-0.5 text-muted-ink">
              Automatically spawn rayu serve if socket is unreachable
            </div>
          </div>
          <Switch
            checked={runtime.autoStart}
            onCheckedChange={(checked) =>
              void onUpdateRuntime({ autoStart: checked }).catch(() => {})
            }
            aria-label="Auto-start shared daemon"
            data-testid="runtime-autostart-switch"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="font-medium text-ink">
              Provider Transport (RuntimeCommand::Transport)
            </div>
            <div className="mt-0.5 text-muted-ink">
              Wire protocol for upstream model inference connections
            </div>
          </div>
          <Select
            value={runtime.transport}
            onValueChange={(v) =>
              void onUpdateRuntime({
                transport: v as ProviderTransport,
              }).catch(() => {})
            }
          >
            <SelectTrigger
              aria-label="Provider transport"
              data-testid="runtime-transport-select"
              className="w-[150px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="auto">auto</SelectItem>
              <SelectItem value="https">https</SelectItem>
              <SelectItem value="websocket">websocket</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Provider & Auth Doctor Diagnostics */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Stethoscope
              className="size-4 text-brand-text"
              aria-hidden="true"
            />
            <h2 className="m-0 text-xs font-semibold text-ink">
              Provider &amp; Auth Doctor (RuntimeCommand::Doctor)
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="default"
              size="xs"
              disabled={!isConnected || isRunningDoctor}
              title={
                !isConnected
                  ? "Connect to the local Rayu daemon to run Provider Doctor"
                  : undefined
              }
              onClick={() => void onRunDoctor("providers").catch(() => {})}
              data-testid="run-provider-doctor-btn"
            >
              <span>Run Provider Doctor</span>
            </Button>
            <Button
              type="button"
              variant="default"
              size="xs"
              disabled={!isConnected || isRunningDoctor}
              title={
                !isConnected
                  ? "Connect to the local Rayu daemon to run Auth Doctor"
                  : undefined
              }
              onClick={() => void onRunDoctor("auth").catch(() => {})}
              data-testid="run-auth-doctor-btn"
            >
              <span>Run Auth Doctor</span>
            </Button>
          </div>
        </div>

        <div
          data-testid="doctor-results-list"
          className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-xl border border-premium bg-pane"
        >
          {doctorResults.length === 0 ? (
            <div className="px-4 py-5 text-center text-xs text-muted-ink">
              {isConnected
                ? "Click \u201cRun Provider Doctor\u201d or \u201cRun Auth Doctor\u201d to inspect live endpoint reachability and credential health."
                : "Rayu daemon is offline \u2014 connect the local daemon to run Provider & Auth Doctor checks."}
            </div>
          ) : (
            doctorResults.map((chk) => (
              <div
                key={chk.id}
                data-testid={`doctor-check-${chk.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 text-xs"
              >
                <div className="flex items-center gap-2.5">
                  {chk.status === "pass" ? (
                    <CheckCircle2 className="size-4 shrink-0 text-brand-text" />
                  ) : chk.status === "warn" ? (
                    <TriangleAlert className="size-4 shrink-0 text-warn" />
                  ) : (
                    <XCircle className="size-4 shrink-0 text-danger" />
                  )}
                  <div>
                    <div className="font-medium text-ink">{chk.label}</div>
                    <div className="text-[11px] text-muted-ink">
                      {chk.detail}
                    </div>
                  </div>
                </div>
                <span className="rounded-full border border-hairline bg-inset px-2 py-0.5 font-mono text-[10px] uppercase text-muted-ink">
                  {chk.scope} · {chk.status}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Contextual Self-Dev Controls (selfdev / desktop_selfdev) */}
      <div
        data-testid="selfdev-card"
        className="rayu-card-bevel rounded-xl border border-premium bg-pane p-4 text-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Wrench className="size-4 text-brand-text" aria-hidden="true" />
            <div>
              <div className="font-semibold text-ink">
                Self-Dev Channel Controls (selfdev / desktop_selfdev)
              </div>
              <div className="text-[11px] text-muted-ink">
                Build local rayucode-v2 checkout and repoint
                ~/.rayu/builds/current/rayu
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={!isConnected || isRunningSelfDev}
              title={
                !isConnected
                  ? "Connect to the local Rayu daemon to check self-dev status"
                  : undefined
              }
              onClick={() => void onRunSelfDev("status").catch(() => {})}
              data-testid="selfdev-status-btn"
            >
              Status
            </Button>
            <Button
              type="button"
              variant="default"
              size="xs"
              disabled
              title="Use Rayu self-dev in the terminal"
              onClick={() => void onRunSelfDev("build").catch(() => {})}
              data-testid="selfdev-build-btn"
            >
              Build Self-Dev
            </Button>
            <Button
              type="button"
              variant="primary"
              size="xs"
              disabled
              title="Use Rayu self-dev in the terminal"
              onClick={() => void onRunSelfDev("reload").catch(() => {})}
              data-testid="selfdev-reload-btn"
            >
              Repoint &amp; Reload
            </Button>
          </div>
        </div>

        {selfDevOutput && (
          <div
            data-testid="selfdev-output"
            className="mt-3 rounded-lg border border-hairline bg-inset px-3 py-2 font-mono text-[11px] text-brand-text"
          >
            {selfDevOutput}
          </div>
        )}
      </div>

      {/* 6 Telemetry Privacy Toggles */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="m-0 text-xs font-semibold text-ink">
              Privacy &amp; Telemetry (6 Categories · RuntimeCommand::Telemetry)
            </h2>
            {telemetry.lockedByEnv && (
              <div className="mt-0.5 text-[11px] text-warn">
                Locked by environment variable{" "}
                {telemetry.envVarName ?? "RAYU_TELEMETRY_DISABLED"}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={telemetry.lockedByEnv}
              onClick={() => void onSetTelemetry("all", true).catch(() => {})}
              data-testid="telemetry-enable-all-btn"
            >
              Enable All
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={telemetry.lockedByEnv}
              onClick={() => void onSetTelemetry("none", false).catch(() => {})}
              data-testid="telemetry-disable-all-btn"
            >
              Disable All
            </Button>
          </div>
        </div>

        <div
          data-testid="telemetry-categories-list"
          className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-xl border border-premium bg-pane"
        >
          {SIX_TELEMETRY_CATEGORIES.map((cat) => (
            <div
              key={cat.id}
              data-testid={`telemetry-row-${cat.id}`}
              className="flex items-center justify-between gap-4 px-4 py-3 text-xs"
            >
              <div>
                <div className="font-medium text-ink">{cat.label}</div>
                <div className="mt-0.5 text-muted-ink">{cat.description}</div>
              </div>
              <Switch
                checked={Boolean(telemetry[cat.id])}
                disabled={telemetry.lockedByEnv}
                onCheckedChange={(checked) =>
                  void onSetTelemetry(cat.id, checked).catch(() => {})
                }
                aria-label={cat.label}
                data-testid={`telemetry-switch-${cat.id}`}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Maintainer Feedback */}
      <div className="rounded-xl border border-hairline bg-pane p-4 text-xs">
        <div className="font-semibold text-ink">
          Send Maintainer Feedback (maintainer_feedback)
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={feedbackSummary}
            onChange={(e) => setFeedbackSummary(e.target.value)}
            placeholder="Describe a bug, suggestion, or usability note..."
            disabled={!operationAvailable("settings.feedback.submit")}
            data-testid="maintainer-feedback-input"
            className="h-8 min-w-0 flex-1 rounded-md border border-control-border bg-inset px-2.5 text-xs text-ink"
          />
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => {
              if (!feedbackSummary.trim()) return;
              void onSubmitFeedback({
                kind: "suggestion",
                summary: feedbackSummary.trim(),
              }).then(() => setFeedbackSummary("")).catch(() => {});
            }}
            disabled={!operationAvailable("settings.feedback.submit")}
            title={
              !operationAvailable("settings.feedback.submit")
                ? "Feedback submission is unavailable in this runtime"
                : undefined
            }
            data-testid="maintainer-feedback-submit"
          >
            Send Feedback
          </Button>
        </div>
      </div>
    </section>
  );
}
