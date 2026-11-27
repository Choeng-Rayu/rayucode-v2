import * as React from "react";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  GatewayStatusView,
  RemoteInfraStatusView,
  SessionSummaryView,
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
    description: "List and pick which local RayuCode session to drive",
  },
  {
    command: "/switch",
    description: "Switch directly to another local RayuCode session",
  },
  {
    command: "/status",
    description: "Inspect active session, model route, and turn state",
  },
  {
    command: "/model",
    description: "Choose a configured provider model for the selected session",
  },
  {
    command: "/provider",
    description: "Browse configured providers on this host",
  },
  {
    command: "/connect",
    description: "Show local host sign-in instructions for a provider",
  },
  {
    command: "/interrupt",
    description: "Cancel the currently running Telegram turn",
  },
  {
    command: "/answer",
    description: "Reply to a pending interactive question from the agent",
  },
  {
    command: "/stop",
    description: "Disconnect Telegram remote control from this host",
  },
  {
    command: "/uninstall",
    description: "Remove managed CLI (guarded by Safety toggle + code)",
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

export function telegramStatusQueryOptions() {
  return queryOptions({
    queryKey: ["remote", "telegram", "status"] as const,
    queryFn: async (): Promise<TelegramStatusView> => {
      return callRpc("remote.telegram.status");
    },
  });
}

export function remoteInfraQueryOptions() {
  return queryOptions({
    queryKey: ["remote", "infra", "status"] as const,
    queryFn: async (): Promise<RemoteInfraStatusView> => {
      return callRpc("remote.infra.status");
    },
  });
}

export function remoteSessionsQueryOptions() {
  return queryOptions({
    queryKey: ["remote", "sessions", "list"] as const,
    queryFn: async (): Promise<SessionSummaryView[]> => {
      try {
        const res = await callRpc("sessions.list", { includeArchived: false });
        return res.sessions ?? [];
      } catch {
        return [];
      }
    },
    staleTime: 15_000,
  });
}

export function useRemote() {
  const queryClient = useQueryClient();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);

  const [activeTab, setActiveTab] = React.useState<RemoteTopTabId>("telegram");
  const [setupMode, setSetupMode] = React.useState<TelegramSetupMode | null>(
    null,
  );
  const [feedbackBanner, setFeedbackBanner] = React.useState<{
    kind: "info" | "error";
    text: string;
  } | null>(null);

  const telegramQuery = useQuery({
    ...telegramStatusQueryOptions(),
    refetchInterval: (query) => {
      const state = query.state.data;
      if (!state || !state.daemonOnline) return false;
      if (!state.linked && Boolean(state.qrPath || state.pairingUrl)) {
        return 2_000;
      }
      if (state.linked) {
        return 5_000;
      }
      return false;
    },
  });

  const infraQuery = useQuery(remoteInfraQueryOptions());
  const sessionsQuery = useQuery(remoteSessionsQueryOptions());

  const prevLinkedRef = React.useRef<boolean | undefined>(undefined);
  React.useEffect(() => {
    const prev = prevLinkedRef.current;
    const next = telegramQuery.data?.linked;
    if (prev === false && next === true && telegramQuery.data) {
      setSetupMode("connected");
      const handle = telegramQuery.data.botHandle
        ? `@${telegramQuery.data.botHandle.replace(/^@+/, "")}`
        : "Telegram";
      setFeedbackBanner({
        kind: "info",
        text: `Telegram connected (${handle}${telegramQuery.data.chatId ? ` · Chat ID ${telegramQuery.data.chatId}` : ""}).`,
      });
    }
    prevLinkedRef.current = next;
  }, [telegramQuery.data]);

  const effectiveSetupMode: TelegramSetupMode =
    setupMode ??
    (telegramQuery.data?.linked
      ? "connected"
      : telegramQuery.data?.mode === "botfather"
        ? "botfather"
        : "hosted");

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
    mutationFn: (replaceExisting?: boolean) =>
      callRpc(
        "remote.telegram.linkHosted",
        replaceExisting ? { replaceExisting: true } : undefined,
      ),
    onSuccess: (res) => {
      queryClient.setQueryData<TelegramStatusView>(
        telegramStatusQueryOptions().queryKey,
        res,
      );
      setSetupMode("hosted");
      setFeedbackBanner({
        kind: "info",
        text: res.pairingCode
          ? `Generated hosted Telegram pairing QR (code ${res.pairingCode}). Scan or open in Telegram and tap Start.`
          : "Generated hosted Telegram pairing link. Open in Telegram and tap Start.",
      });
    },
    onError: (err) => {
      setFeedbackBanner({
        kind: "error",
        text:
          err instanceof Error
            ? err.message
            : "Failed to start hosted Telegram pairing.",
      });
    },
  });

  const linkBotfatherMutation = useMutation({
    mutationFn: (input: {
      botToken: string;
      allowedChatId?: string;
      replaceExisting?: boolean;
    }) => callRpc("remote.telegram.linkBotfather", input),
    onSuccess: (res) => {
      queryClient.setQueryData<TelegramStatusView>(
        telegramStatusQueryOptions().queryKey,
        res,
      );
      const handle = res.botHandle
        ? `@${res.botHandle.replace(/^@+/, "")}`
        : "BotFather bot";
      if (res.linked) {
        setSetupMode("connected");
        setFeedbackBanner({
          kind: "info",
          text: `Verified and linked ${handle}${res.chatId ? ` (Chat ID ${res.chatId})` : ""}.`,
        });
      } else {
        setSetupMode("botfather");
        setFeedbackBanner({
          kind: "info",
          text: `Verified ${handle}. Scan the QR code or open the Start link in Telegram to finish pairing.`,
        });
      }
    },
    onError: (err) => {
      setFeedbackBanner({
        kind: "error",
        text:
          err instanceof Error
            ? err.message
            : "Failed to verify and link @BotFather token.",
      });
    },
  });

  const disconnectTelegramMutation = useMutation({
    mutationFn: (localOnly?: boolean) =>
      callRpc(
        "remote.telegram.disconnect",
        localOnly ? { localOnly: true } : undefined,
      ),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({
        queryKey: telegramStatusQueryOptions().queryKey,
      });
      setSetupMode("hosted");
      setFeedbackBanner({
        kind: "info",
        text: res.message || "Disconnected Telegram bridge on this host.",
      });
    },
    onError: (err) => {
      setFeedbackBanner({
        kind: "error",
        text:
          err instanceof Error
            ? err.message
            : "Failed to disconnect Telegram bridge.",
      });
    },
  });

  const testPingMutation = useMutation({
    mutationFn: () => callRpc("remote.telegram.testPing"),
    onSuccess: (res) => {
      if (!res.ok) {
        setFeedbackBanner({
          kind: "error",
          text: res.message || "Telegram ping failed.",
        });
        return;
      }
      const target = res.target
        ? `@${res.target.replace(/^@+/, "")}`
        : telegramQuery.data?.botHandle
          ? `@${telegramQuery.data.botHandle.replace(/^@+/, "")}`
          : "Telegram";
      setFeedbackBanner({
        kind: "info",
        text:
          res.message ||
          `Sent live Telegram ping to ${target}${res.chatId ? ` (Chat ID ${res.chatId})` : ""}.`,
      });
    },
    onError: (err) => {
      setFeedbackBanner({
        kind: "error",
        text:
          err instanceof Error ? err.message : "Failed to send Telegram ping.",
      });
    },
  });

  const driveSessionMutation = useMutation({
    mutationFn: (sessionId: string) =>
      callRpc("remote.telegram.driveSession", { sessionId }),
    onSuccess: async (res, sessionId) => {
      if (!res.ok) {
        setFeedbackBanner({
          kind: "error",
          text: res.message || "Could not bind session to Telegram bridge.",
        });
        return;
      }
      updateTelegramCache((prev) => ({
        ...prev,
        boundSessionId: sessionId,
      }));
      await queryClient.invalidateQueries({
        queryKey: telegramStatusQueryOptions().queryKey,
      });
      setFeedbackBanner({
        kind: "info",
        text: res.message || `Telegram now drives session ${sessionId}.`,
      });
    },
    onError: (err) => {
      setFeedbackBanner({
        kind: "error",
        text:
          err instanceof Error
            ? err.message
            : "Failed to switch Telegram driving session.",
      });
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
      setFeedbackBanner({
        kind: "info",
        text:
          decision === "allow"
            ? "Approved remote tool request via host."
            : "Denied remote tool request via host.",
      });
    },
    onError: (err) => {
      setFeedbackBanner({
        kind: "error",
        text:
          err instanceof Error
            ? err.message
            : "Failed to submit approval decision.",
      });
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
      setFeedbackBanner({
        kind: "info",
        text: next
          ? "Remote /uninstall guardrail set to Allowed."
          : "Remote /uninstall guardrail set to Blocked (safe default).",
      });
    },
    onError: (err) => {
      setFeedbackBanner({
        kind: "error",
        text:
          err instanceof Error
            ? err.message
            : "Failed to update remote uninstall guardrail.",
      });
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
      setFeedbackBanner({
        kind: "info",
        text: enabled
          ? "Local WebSocket Gateway (:7643) enabled."
          : "Local WebSocket Gateway (:7643) stopped.",
      });
    },
  });

  const pairGatewayMutation = useMutation({
    mutationFn: () => callRpc("remote.gateway.pair"),
    onSuccess: (res: GatewayStatusView) => {
      updateInfraCache((prev) => ({
        ...prev,
        gateway: {
          ...prev.gateway,
          ...res,
        },
      }));
      setFeedbackBanner({
        kind: "info",
        text: res.pairingQr?.code
          ? `Generated 5-minute WebSocket Gateway invite (${res.pairingQr.code}).`
          : "Generated WebSocket Gateway pairing invite.",
      });
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
      setFeedbackBanner({
        kind: "info",
        text: `Revoked paired device ${deviceId}.`,
      });
    },
  });

  const moveToCloudMutation = useMutation({
    mutationFn: (sessionId: string) =>
      callRpc("remote.cloud.moveToCloud", { sessionId }),
    onSuccess: async (res, sessionId) => {
      await queryClient.invalidateQueries({
        queryKey: remoteInfraQueryOptions().queryKey,
      });
      setFeedbackBanner({
        kind: "info",
        text:
          res.message ||
          `Moved session ${sessionId} to Rayu Cloud${res.remoteSessionId ? ` (${res.remoteSessionId})` : ""}.`,
      });
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
      setFeedbackBanner({
        kind: "info",
        text:
          res.message ||
          `Returned remote session ${remoteSessionId} to local VS Code host.`,
      });
    },
  });

  const attachRemoteMutation = useMutation({
    mutationFn: (remoteSessionId: string) =>
      callRpc("remote.cloud.attach", { remoteSessionId }),
    onSuccess: (res, remoteSessionId) => {
      setFeedbackBanner({
        kind: "info",
        text: res.message || `Attached to remote session ${remoteSessionId}.`,
      });
    },
  });

  const syncCloudEnvMutation = useMutation({
    mutationFn: () => callRpc("remote.cloud.syncEnv"),
    onSuccess: () => {
      setFeedbackBanner({
        kind: "info",
        text: "Synced local workspace environment with Rayu Cloud.",
      });
    },
  });

  const copyToClipboard = React.useCallback((text: string, label: string) => {
    postToHost({ type: "rayucode.host.copyToClipboard", text });
    setFeedbackBanner({
      kind: "info",
      text: `Copied ${label} to clipboard.`,
    });
  }, []);

  const openExternalUrl = React.useCallback((url: string) => {
    if (!url) return;
    postToHost({ type: "rayucode.editor.openExternal", url });
  }, []);

  return {
    activeTab,
    setActiveTab,
    setupMode: effectiveSetupMode,
    setSetupMode,
    feedbackBanner,
    clearFeedbackBanner: () => setFeedbackBanner(null),
    telegram: telegramQuery.data ?? null,
    infra: infraQuery.data ?? null,
    sessions: sessionsQuery.data ?? [],
    isLoading: telegramQuery.isPending || infraQuery.isPending,
    isError: telegramQuery.isError || infraQuery.isError,
    error: telegramQuery.error ?? infraQuery.error,
    refetchAll: () => {
      void telegramQuery.refetch();
      void infraQuery.refetch();
      void sessionsQuery.refetch();
    },
    activeSessionId: activeSessionId ?? "",
    navigateToSettings: () => setActiveRoute("settings"),
    copyToClipboard,
    openExternalUrl,
    linkHosted: (replaceExisting?: boolean) =>
      linkHostedMutation.mutateAsync(replaceExisting),
    isLinkingHosted: linkHostedMutation.isPending,
    hostedError:
      linkHostedMutation.error instanceof Error
        ? linkHostedMutation.error.message
        : null,
    linkBotfather: (input: {
      botToken: string;
      allowedChatId?: string;
      replaceExisting?: boolean;
    }) => linkBotfatherMutation.mutateAsync(input),
    isLinkingBotfather: linkBotfatherMutation.isPending,
    botfatherError:
      linkBotfatherMutation.error instanceof Error
        ? linkBotfatherMutation.error.message
        : null,
    disconnectTelegram: (localOnly?: boolean) =>
      disconnectTelegramMutation.mutateAsync(localOnly),
    isDisconnectingTelegram: disconnectTelegramMutation.isPending,
    sendTestPing: () => testPingMutation.mutateAsync(),
    isPingingTelegram: testPingMutation.isPending,
    driveActiveSession: (sessionId?: string) => {
      const target = sessionId ?? activeSessionId ?? "";
      if (!target) {
        setFeedbackBanner({
          kind: "error",
          text: "Open or select a local session first to drive it from Telegram.",
        });
        return Promise.resolve();
      }
      return driveSessionMutation.mutateAsync(target);
    },
    isDrivingSession: driveSessionMutation.isPending,
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
      moveToCloudMutation.mutateAsync(sessionId ?? activeSessionId ?? ""),
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
