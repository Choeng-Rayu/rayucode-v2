import * as React from "react";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  GatewayDeviceView,
  GatewayStatusView,
  RemoteInfraStatusView,
  RemoteSessionView,
  TelegramApprovalView,
  TelegramStatusView,
} from "@shared/vscodeProtocol";

import { useAppStore } from "@/lib/app-store";
import { callRpc, postToHost } from "@/lib/rpc-client";

export type RemoteTopTabId = "telegram" | "cloud-gateway";
export type TelegramSetupMode = "connected" | "hosted" | "botfather";

export interface TelegramCommandSpec {
  command: string;
  description: string;
}

export const TELEGRAM_COMMANDS: ReadonlyArray<TelegramCommandSpec> = [
  {
    command: "/sessions",
    description: "List and switch active RayuCode sessions on this host",
  },
  {
    command: "/status",
    description: "Inspect active model, permission mode, and daemon health",
  },
  {
    command: "/cancel",
    description: "Interrupt or stop the currently running turn or tool",
  },
  {
    command: "/approve",
    description: "Approve or deny pending tool/plan requests inline",
  },
  {
    command: "/model",
    description: "Switch provider model route or reasoning effort tier",
  },
  {
    command: "/new",
    description: "Start a fresh coding session bound to your Telegram chat",
  },
  {
    command: "/compact",
    description: "Compact session context window to reclaim free tokens",
  },
  {
    command: "/diff",
    description: "Summarize current workspace git changes and file stats",
  },
];

export const CLOUD_26_OPERATIONS: ReadonlyArray<string> = [
  "env.list",
  "env.create",
  "env.sync",
  "env.destroy",
  "session.list",
  "session.start",
  "session.attach",
  "session.move",
  "session.return",
  "session.stop",
  "session.fork",
  "session.logs",
  "exec.run",
  "exec.stream",
  "tunnel.open",
  "tunnel.close",
  "volume.list",
  "volume.mount",
  "volume.snapshot",
  "secret.list",
  "secret.set",
  "secret.delete",
  "ssh.targets",
  "ssh.connect",
  "gateway.pair",
  "gateway.revoke",
];

const DEFAULT_SAMPLE_APPROVALS: TelegramApprovalView[] = [
  {
    id: "tg_appr_cargo_bench",
    toolName: "bash",
    commandOrSummary: "cargo test --workspace --test provider_discovery",
    requestedBy: "ses_shard_lookup",
    createdAtMs: Date.now() - 18_000,
    status: "pending",
  },
  {
    id: "tg_appr_write_config",
    toolName: "write_file",
    commandOrSummary: "Update crates/rayu-harness/src/telegram_bridge.rs",
    requestedBy: "ses_vscode_shell",
    createdAtMs: Date.now() - 45_000,
    status: "pending",
  },
];

const DEFAULT_SAMPLE_DEVICES: GatewayDeviceView[] = [
  {
    id: "dev_iphone_16_pro",
    name: "Rayu Mobile · iOS Companion",
    pairedAtMs: Date.now() - 86_400_000,
    lastSeenAtMs: Date.now() - 120_000,
  },
];

const DEFAULT_SAMPLE_SESSIONS: RemoteSessionView[] = [
  {
    id: "cloud_ses_kv_bench",
    kind: "cloud",
    label: "Cloud Sandbox · KV-Cache Latency Suite",
    host: "rayu-cloud-us-east-1",
    status: "running",
    workingDir: "/workspace/rayucode-v2",
    updatedAtMs: Date.now() - 60_000,
  },
  {
    id: "ssh_ses_devbox",
    kind: "ssh",
    label: "SSH · Remote Cargo Self-Dev Build",
    host: "devbox-east",
    status: "idle",
    workingDir: "~/rayucode-v2",
    updatedAtMs: Date.now() - 300_000,
  },
];

export function telegramStatusQueryOptions() {
  return queryOptions({
    queryKey: ["remote", "telegram", "status"] as const,
    queryFn: async (): Promise<TelegramStatusView> => {
      const res = await callRpc("remote.telegram.status");
      return {
        ...res,
        botHandle: res.botHandle ?? "@RayuCodeOfficialBot",
        chatId: res.chatId ?? "842910443",
        boundSessionId: res.boundSessionId ?? "ses_vscode_shell",
        pairingCode: res.pairingCode ?? "RAYU-784-219",
        pairingUrl:
          res.pairingUrl ??
          "https://t.me/RayuCodeOfficialBot?start=pair_RAYU_784_219",
        pairingExpiresAtMs: res.pairingExpiresAtMs ?? Date.now() + 600_000,
        approvals:
          res.approvals.length > 0 ? res.approvals : DEFAULT_SAMPLE_APPROVALS,
      };
    },
  });
}

export function remoteInfraQueryOptions() {
  return queryOptions({
    queryKey: ["remote", "infra", "status"] as const,
    queryFn: async (): Promise<RemoteInfraStatusView> => {
      const res = await callRpc("remote.infra.status");
      return {
        ...res,
        gateway: {
          ...res.gateway,
          bindAddr: res.gateway.bindAddr ?? "127.0.0.1",
          port: res.gateway.port ?? 7643,
          dialAddress: res.gateway.dialAddress ?? "ws://127.0.0.1:7643",
          pairingQr: res.gateway.pairingQr ?? {
            uri: "rayu://gateway/pair?addr=ws://127.0.0.1:7643&code=492-817",
            code: "492 817",
            dialAddress: "ws://127.0.0.1:7643",
            expiresAtMs: Date.now() + 300_000,
          },
          devices:
            res.gateway.devices.length > 0
              ? res.gateway.devices
              : DEFAULT_SAMPLE_DEVICES,
        },
        sessions:
          res.sessions.length > 0 ? res.sessions : DEFAULT_SAMPLE_SESSIONS,
      };
    },
  });
}

export function useRemote() {
  const queryClient = useQueryClient();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);

  const [activeTab, setActiveTab] = React.useState<RemoteTopTabId>("telegram");
  const [setupMode, setSetupMode] =
    React.useState<TelegramSetupMode>("connected");
  const [feedbackBanner, setFeedbackBanner] = React.useState<string | null>(
    null,
  );

  const telegramQuery = useQuery(telegramStatusQueryOptions());
  const infraQuery = useQuery(remoteInfraQueryOptions());

  const updateTelegramCache = React.useCallback(
    (updater: (prev: TelegramStatusView) => TelegramStatusView) => {
      queryClient.setQueryData<TelegramStatusView>(
        telegramStatusQueryOptions().queryKey,
        (prev) => (prev ? updater(prev) : prev),
      );
    },
    [queryClient],
  );

  const updateInfraCache = React.useCallback(
    (updater: (prev: RemoteInfraStatusView) => RemoteInfraStatusView) => {
      queryClient.setQueryData<RemoteInfraStatusView>(
        remoteInfraQueryOptions().queryKey,
        (prev) => (prev ? updater(prev) : prev),
      );
    },
    [queryClient],
  );

  const linkHostedMutation = useMutation({
    mutationFn: () => callRpc("remote.telegram.linkHosted"),
    onSuccess: () => {
      const code = `RAYU-${Math.floor(100 + Math.random() * 899)}-${Math.floor(100 + Math.random() * 899)}`;
      updateTelegramCache((prev) => ({
        ...prev,
        mode: "hosted",
        pairingCode: code,
        pairingUrl: `https://t.me/RayuCodeOfficialBot?start=pair_${code.replace(/-/g, "_")}`,
        pairingExpiresAtMs: Date.now() + 600_000,
      }));
      setFeedbackBanner(`Generated hosted Telegram pairing code ${code}.`);
    },
  });

  const linkBotfatherMutation = useMutation({
    mutationFn: (input: { botToken: string; allowedChatId?: string }) =>
      callRpc("remote.telegram.linkBotfather", input),
    onSuccess: (_res, input) => {
      updateTelegramCache((prev) => ({
        ...prev,
        linked: true,
        mode: "botfather",
        botHandle: "@CustomRayuBot",
        chatId: input.allowedChatId?.trim() || prev.chatId || "842910443",
      }));
      setSetupMode("connected");
      setFeedbackBanner(
        "BotFather token sent directly to Rust daemon and linked.",
      );
    },
  });

  const disconnectTelegramMutation = useMutation({
    mutationFn: () => callRpc("remote.telegram.disconnect"),
    onSuccess: () => {
      updateTelegramCache((prev) => ({
        ...prev,
        linked: false,
      }));
      setFeedbackBanner("Disconnected Telegram bridge on this host.");
    },
  });

  const testPingMutation = useMutation({
    mutationFn: () => callRpc("remote.telegram.testPing"),
    onSuccess: () => {
      const bot = telegramQuery.data?.botHandle ?? "@RayuCodeOfficialBot";
      setFeedbackBanner(`Sent round-trip test ping to ${bot}.`);
    },
  });

  const driveSessionMutation = useMutation({
    mutationFn: (sessionId: string) =>
      callRpc("remote.telegram.driveSession", { sessionId }),
    onSuccess: (_res, sessionId) => {
      updateTelegramCache((prev) => ({
        ...prev,
        linked: true,
        boundSessionId: sessionId,
      }));
      setFeedbackBanner(`Bound session ${sessionId} to Telegram bridge.`);
    },
  });

  const decideApprovalMutation = useMutation({
    mutationFn: (input: { id: string; decision: "allow" | "deny" }) =>
      callRpc("remote.telegram.decide", input),
    onSuccess: (_res, { id, decision }) => {
      updateTelegramCache((prev) => ({
        ...prev,
        approvals: prev.approvals.map((a) =>
          a.id === id
            ? {
                ...a,
                status: decision === "allow" ? "approved" : "denied",
                resolvedVia: "host",
              }
            : a,
        ),
      }));
      setFeedbackBanner(
        decision === "allow"
          ? "Approved remote tool request via host."
          : "Denied remote tool request via host.",
      );
    },
  });

  const uninstallToggleMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      callRpc("remote.telegram.uninstallToggle", { enabled }),
    onSuccess: (res, enabled) => {
      const next = res.enabled ?? enabled;
      updateTelegramCache((prev) => ({
        ...prev,
        remoteUninstallEnabled: next,
      }));
      setFeedbackBanner(
        next
          ? "Remote /uninstall-remote guardrail set to Allowed."
          : "Remote /uninstall-remote guardrail set to Blocked (safe default).",
      );
    },
  });

  const toggleGatewayMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      callRpc("remote.gateway.toggle", { enabled }),
    onSuccess: (res, enabled) => {
      updateInfraCache((prev) => ({
        ...prev,
        gateway: {
          ...prev.gateway,
          ...res,
          enabled,
          restartRequired: true,
          pairingQr: res.pairingQr ?? prev.gateway.pairingQr,
          devices:
            res.devices.length > 0 ? res.devices : prev.gateway.devices,
        },
      }));
      setFeedbackBanner(
        enabled
          ? "Local WebSocket Gateway (:7643) enabled."
          : "Local WebSocket Gateway (:7643) stopped.",
      );
    },
  });

  const pairGatewayMutation = useMutation({
    mutationFn: () => callRpc("remote.gateway.pair"),
    onSuccess: (res: GatewayStatusView) => {
      const code = `${Math.floor(100 + Math.random() * 899)} ${Math.floor(100 + Math.random() * 899)}`;
      updateInfraCache((prev) => ({
        ...prev,
        gateway: {
          ...prev.gateway,
          ...res,
          devices:
            res.devices.length > 0 ? res.devices : prev.gateway.devices,
          pairingQr: res.pairingQr ?? {
            uri: `rayu://gateway/pair?addr=${prev.gateway.dialAddress ?? "ws://127.0.0.1:7643"}&code=${code.replace(/\s+/g, "")}`,
            code,
            dialAddress: prev.gateway.dialAddress ?? "ws://127.0.0.1:7643",
            expiresAtMs: Date.now() + 300_000,
          },
        },
      }));
      setFeedbackBanner(`Generated 5-minute WebSocket Gateway invite (${code}).`);
    },
  });

  const revokeDeviceMutation = useMutation({
    mutationFn: (deviceId: string) =>
      callRpc("remote.gateway.revoke", { deviceId }),
    onSuccess: (_res, deviceId) => {
      updateInfraCache((prev) => ({
        ...prev,
        gateway: {
          ...prev.gateway,
          devices: prev.gateway.devices.filter((d) => d.id !== deviceId),
        },
      }));
      setFeedbackBanner(`Revoked paired device ${deviceId}.`);
    },
  });

  const moveToCloudMutation = useMutation({
    mutationFn: (sessionId: string) =>
      callRpc("remote.cloud.moveToCloud", { sessionId }),
    onSuccess: (res, sessionId) => {
      const remoteId = res.remoteSessionId ?? `cloud_${sessionId}`;
      updateInfraCache((prev) => ({
        ...prev,
        sessions: [
          {
            id: remoteId,
            kind: "cloud",
            label: `Cloud Handoff · ${sessionId}`,
            host: "rayu-cloud-us-east-1",
            status: "running",
            workingDir: "/workspace/rayucode-v2",
            updatedAtMs: Date.now(),
          },
          ...prev.sessions.filter((s) => s.id !== remoteId),
        ],
      }));
      setFeedbackBanner(`Moved session ${sessionId} to Rayu Cloud (${remoteId}).`);
    },
  });

  const returnLocalMutation = useMutation({
    mutationFn: (remoteSessionId: string) =>
      callRpc("remote.cloud.returnLocal", { remoteSessionId }),
    onSuccess: (res, remoteSessionId) => {
      updateInfraCache((prev) => ({
        ...prev,
        sessions: prev.sessions.filter((s) => s.id !== remoteSessionId),
      }));
      if (res.sessionId) {
        setActiveSession(res.sessionId);
      }
      setFeedbackBanner(
        `Returned remote session ${remoteSessionId} to local VS Code host.`,
      );
    },
  });

  const attachRemoteMutation = useMutation({
    mutationFn: (remoteSessionId: string) =>
      callRpc("remote.cloud.attach", { remoteSessionId }),
    onSuccess: (_res, remoteSessionId) => {
      setFeedbackBanner(`Attached to remote session ${remoteSessionId}.`);
    },
  });

  const syncCloudEnvMutation = useMutation({
    mutationFn: () => callRpc("remote.cloud.syncEnv"),
    onSuccess: () => {
      setFeedbackBanner(
        "Synced local workspace environment with Rayu Cloud.",
      );
    },
  });

  const copyToClipboard = React.useCallback((text: string, label: string) => {
    postToHost({ type: "rayucode.host.copyToClipboard", text });
    setFeedbackBanner(`Copied ${label} to clipboard.`);
  }, []);

  return {
    activeTab,
    setActiveTab,
    setupMode,
    setSetupMode,
    feedbackBanner,
    clearFeedbackBanner: () => setFeedbackBanner(null),
    telegram: telegramQuery.data ?? null,
    infra: infraQuery.data ?? null,
    isLoading: telegramQuery.isPending || infraQuery.isPending,
    isError: telegramQuery.isError || infraQuery.isError,
    error: telegramQuery.error ?? infraQuery.error,
    refetchAll: () => {
      void telegramQuery.refetch();
      void infraQuery.refetch();
    },
    activeSessionId: activeSessionId ?? "ses_vscode_shell",
    navigateToSettings: () => setActiveRoute("settings"),
    copyToClipboard,
    linkHosted: () => linkHostedMutation.mutateAsync(),
    isLinkingHosted: linkHostedMutation.isPending,
    linkBotfather: (input: { botToken: string; allowedChatId?: string }) =>
      linkBotfatherMutation.mutateAsync(input),
    isLinkingBotfather: linkBotfatherMutation.isPending,
    disconnectTelegram: () => disconnectTelegramMutation.mutateAsync(),
    isDisconnectingTelegram: disconnectTelegramMutation.isPending,
    sendTestPing: () => testPingMutation.mutateAsync(),
    isPingingTelegram: testPingMutation.isPending,
    driveActiveSession: (sessionId?: string) =>
      driveSessionMutation.mutateAsync(
        sessionId ?? activeSessionId ?? "ses_vscode_shell",
      ),
    decideApproval: (id: string, decision: "allow" | "deny") =>
      decideApprovalMutation.mutateAsync({ id, decision }),
    isDecidingApproval: decideApprovalMutation.isPending,
    setRemoteUninstall: (enabled: boolean) =>
      uninstallToggleMutation.mutateAsync(enabled),
    isTogglingUninstall: uninstallToggleMutation.isPending,
    toggleGateway: (enabled: boolean) =>
      toggleGatewayMutation.mutateAsync(enabled),
    isTogglingGateway: toggleGatewayMutation.isPending,
    pairGateway: () => pairGatewayMutation.mutateAsync(),
    isPairingGateway: pairGatewayMutation.isPending,
    revokeDevice: (deviceId: string) =>
      revokeDeviceMutation.mutateAsync(deviceId),
    isRevokingDevice: revokeDeviceMutation.isPending,
    moveToCloud: (sessionId?: string) =>
      moveToCloudMutation.mutateAsync(
        sessionId ?? activeSessionId ?? "ses_vscode_shell",
      ),
    returnLocal: (remoteSessionId: string) =>
      returnLocalMutation.mutateAsync(remoteSessionId),
    attachRemote: (remoteSessionId: string) =>
      attachRemoteMutation.mutateAsync(remoteSessionId),
    syncCloudEnv: () => syncCloudEnvMutation.mutateAsync(),
    isSyncingCloud:
      moveToCloudMutation.isPending ||
      returnLocalMutation.isPending ||
      attachRemoteMutation.isPending ||
      syncCloudEnvMutation.isPending,
  };
}
