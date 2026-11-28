import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildDeterministicQrMatrix,
  RemoteView,
} from "@/features/remote";
import {
  __dispatchHostMessageForTest,
  createQueryClient,
  handleMockHostMessage,
  useAppStore,
} from "@/lib";
import * as rpcClient from "@/lib/rpc-client";

function renderWithQuery(ui: React.ReactElement, client = createQueryClient()) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
    ),
  };
}

describe("Remote Access Feature (Real Telegram & Gateway)", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1280,
    });
    useAppStore.setState({
      surface: "editorPanel",
      route: "remote",
      activeRoute: "remote",
      activeSessionId: "ses_vscode_shell",
    });
  });

  it("builds a deterministic 21x21 fallback QR matrix with 7x7 finder patterns", () => {
    const m1 = buildDeterministicQrMatrix("rayu://gateway/pair?code=1");
    const m2 = buildDeterministicQrMatrix("rayu://gateway/pair?code=1");
    expect(m1.length).toBe(21);
    expect(m1[0]?.length).toBe(21);
    expect(m1).toEqual(m2);
    expect(m1[0]?.[0]).toBe(true);
    expect(m1[2]?.[2]).toBe(true);
  });

  it("renders truthful disconnected Telegram state, generates real Hosted QR, links @BotFather token, and enforces Remote Uninstall guardrail", async () => {
    renderWithQuery(<RemoteView />);

    await waitFor(() => {
      expect(screen.getByTestId("remote-view")).toBeTruthy();
    });

    expect(screen.getByTestId("tg-status-banner")).toBeTruthy();
    expect(screen.getByTestId("tg-approvals-list")).toBeTruthy();
    // Truthful empty approvals queue (zero fabricated sample approvals)
    expect(screen.getByTestId("tg-pending-count-badge").textContent).toContain(
      "0 pending",
    );

    // Hosted Pairing QR mode -> Generate Hosted QR -> renders real Rust SVG path
    const hostedTab = screen.getByTestId("tg-mode-hosted");
    fireEvent.mouseDown(hostedTab);
    fireEvent.click(hostedTab);
    const generateBtn = await screen.findByTestId("tg-generate-qr-btn");
    fireEvent.click(generateBtn);
    await waitFor(() => {
      const qr = screen.getByTestId("tg-qr-matrix");
      expect(qr.querySelector("svg path")).toBeTruthy();
      expect(screen.getByTestId("tg-pairing-code")).toBeTruthy();
    });

    // Switch to BYO @BotFather Token mode & link directly with chat ID
    const botfatherTab = screen.getByTestId("tg-mode-botfather");
    fireEvent.mouseDown(botfatherTab);
    fireEvent.click(botfatherTab);
    await waitFor(() => {
      expect(screen.getByTestId("tg-byo-token-input")).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId("tg-byo-token-input"), {
      target: { value: "123456789:AAF_ValidBotFatherToken123456789" },
    });
    fireEvent.change(screen.getByTestId("tg-byo-chat-id-input"), {
      target: { value: "842910443" },
    });
    fireEvent.click(screen.getByTestId("tg-byo-submit-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("tg-status-pill").textContent).toBe("Connected");
    });

    // Toggle Remote Uninstall Safety Switch -> opens guardrail confirmation dialog
    fireEvent.click(screen.getByTestId("tg-remote-uninstall-switch"));
    await waitFor(() => {
      expect(screen.getByTestId("tg-uninstall-confirm-dialog")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("tg-uninstall-confirm-btn"));
    await waitFor(() => {
      expect(
        screen.getByTestId("tg-remote-uninstall-badge").textContent,
      ).toContain("Allowed");
    });
  });

  it("renders Cloud, SSH & Mobile Gateway tab with :7643 WebSocket controls and SSH hosts", async () => {
    renderWithQuery(<RemoteView />);

    await waitFor(() => {
      expect(screen.getByTestId("remote-view")).toBeTruthy();
    });

    const cloudTab = screen.getByTestId("remote-tab-cloud-gateway");
    fireEvent.mouseDown(cloudTab);
    fireEvent.click(cloudTab);

    await waitFor(() => {
      expect(screen.getByTestId("cloud-gateway-tab")).toBeTruthy();
    });

    expect(screen.getByTestId("gateway-bind-address").textContent).toBe(
      "127.0.0.1:7643",
    );
    expect(screen.getByTestId("ssh-hosts-list")).toBeTruthy();
    expect(screen.getByTestId("cloud-26-ops-grid").children.length).toBe(26);

    fireEvent.click(screen.getByTestId("gateway-toggle-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("gateway-status-badge").textContent).toBe(
        "Enabled",
      );
    });
  });

  it("surfaces visible errors on { ok: false } and rejected Remote RPC mutations without publishing success, mutating query cache, or clearing form inputs", async () => {
    const origCallRpc = rpcClient.callRpc;
    const rpcSpy = vi.spyOn(rpcClient, "callRpc");
    const toastErrorSpy = vi.spyOn(toast, "error");
    const toastSuccessSpy = vi.spyOn(toast, "success");

    rpcSpy.mockImplementation((async (
      method: string,
      params?: Record<string, unknown>,
    ) => {
      if (method === "remote.telegram.status") {
        const base = (await origCallRpc(
          method as never,
          params as never,
        )) as Record<string, unknown>;
        return {
          ...base,
          linked: false,
          remoteUninstallEnabled: false,
        };
      }
      if (method === "remote.telegram.linkBotfather") {
        throw new Error("BotFather token verification rejected by daemon");
      }
      if (method === "remote.telegram.uninstallToggle") {
        return {
          ok: false,
          enabled: false,
          message: "Remote uninstall toggle blocked by host policy",
        };
      }
      if (method === "remote.gateway.revoke") {
        return {
          ok: false,
          message: "Could not revoke paired gateway device",
        };
      }
      return origCallRpc(method as never, params as never);
    }) as typeof rpcClient.callRpc);

    try {
      const { client } = renderWithQuery(<RemoteView />);

      await waitFor(() => {
        expect(screen.getByTestId("remote-view")).toBeTruthy();
      });

      // 1. Rejected @BotFather link retains token + chatId inputs and does not mark linked
      const botfatherTab = screen.getByTestId("tg-mode-botfather");
      fireEvent.mouseDown(botfatherTab);
      fireEvent.click(botfatherTab);

      const tokenInput = (await screen.findByTestId(
        "tg-byo-token-input",
      )) as HTMLInputElement;
      const chatIdInput = screen.getByTestId(
        "tg-byo-chat-id-input",
      ) as HTMLInputElement;

      fireEvent.change(tokenInput, {
        target: { value: "123456789:AAF_ValidBotFatherToken123456789" },
      });
      fireEvent.change(chatIdInput, {
        target: { value: "842910443" },
      });
      fireEvent.click(screen.getByTestId("tg-byo-submit-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("remote-feedback-banner").getAttribute("role")).toBe(
          "alert",
        );
      });
      expect(screen.getByTestId("remote-feedback-banner").textContent).toContain(
        "BotFather token verification rejected by daemon",
      );
      expect(tokenInput.value).toBe("123456789:AAF_ValidBotFatherToken123456789");
      expect(chatIdInput.value).toBe("842910443");
      expect(screen.getByTestId("tg-status-pill").textContent).not.toBe(
        "Connected",
      );
      expect(toastSuccessSpy).not.toHaveBeenCalled();

      // 2. { ok: false } on remote.telegram.uninstallToggle does not flip cache or badge to Allowed
      fireEvent.click(screen.getByTestId("tg-remote-uninstall-switch"));
      await waitFor(() => {
        expect(screen.getByTestId("tg-uninstall-confirm-dialog")).toBeTruthy();
      });
      fireEvent.click(screen.getByTestId("tg-uninstall-confirm-btn"));

      await waitFor(() => {
        expect(
          toastErrorSpy.mock.calls.length > 0 ||
            screen.queryByRole("alert") !== null,
        ).toBe(true);
      });
      expect(
        screen.getByTestId("tg-remote-uninstall-badge").textContent,
      ).not.toContain("Allowed");
      const tgCached = client.getQueryData<{ remoteUninstallEnabled?: boolean }>([
        "remote",
        "telegram",
        "status",
      ]);
      expect(tgCached?.remoteUninstallEnabled).toBe(false);

      // 3. { ok: false } on remote.gateway.revoke does not remove device from cache
      const cloudTab = screen.getByTestId("remote-tab-cloud-gateway");
      fireEvent.mouseDown(cloudTab);
      fireEvent.click(cloudTab);
      await waitFor(() => {
        expect(screen.getByTestId("cloud-gateway-tab")).toBeTruthy();
      });

      const infraBefore = client.getQueryData<{
        gateway: { devices: Array<{ id: string }> };
      }>(["remote", "infra", "status"]);
      const deviceCountBefore = infraBefore?.gateway.devices.length ?? 0;
      const firstDeviceId = infraBefore?.gateway.devices[0]?.id;
      if (firstDeviceId) {
        fireEvent.click(screen.getByTestId(`gateway-revoke-${firstDeviceId}`));
        await waitFor(() => {
          expect(rpcSpy).toHaveBeenCalledWith("remote.gateway.revoke", {
            deviceId: firstDeviceId,
          });
        });
        const infraAfter = client.getQueryData<{
          gateway: { devices: Array<{ id: string }> };
        }>(["remote", "infra", "status"]);
        expect(infraAfter?.gateway.devices.length).toBe(deviceCountBefore);
      }
    } finally {
      rpcSpy.mockRestore();
      toastErrorSpy.mockRestore();
      toastSuccessSpy.mockRestore();
    }
  });

  it("keeps unsupported Cloud session & environment controls disabled in VS Code webview host mode", async () => {
    const prevAcquire = window.acquireVsCodeApi;
    window.acquireVsCodeApi = () => ({
      postMessage: (msg: unknown) => {
        handleMockHostMessage(msg as never, __dispatchHostMessageForTest);
      },
      getState: () => undefined,
      setState: () => {},
    });

    try {
      renderWithQuery(<RemoteView />);

      await waitFor(() => {
        expect(screen.getByTestId("remote-view")).toBeTruthy();
      });

      const cloudTab = screen.getByTestId("remote-tab-cloud-gateway");
      fireEvent.mouseDown(cloudTab);
      fireEvent.click(cloudTab);

      await waitFor(() => {
        expect(screen.getByTestId("cloud-gateway-tab")).toBeTruthy();
      });

      expect(
        (screen.getByTestId("cloud-sync-env-btn") as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(
        (screen.getByTestId("cloud-move-session-btn") as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    } finally {
      window.acquireVsCodeApi = prevAcquire;
    }
  });
});
