import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  buildDeterministicQrMatrix,
  RemoteView,
} from "@/features/remote";
import { createQueryClient, useAppStore } from "@/lib";

function renderWithQuery(ui: React.ReactElement) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("Remote Access Feature (Wave 3F — Spec 08)", () => {
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

  it("builds a deterministic 21x21 QR matrix with 7x7 finder patterns", () => {
    const m1 = buildDeterministicQrMatrix("https://t.me/RayuCodeOfficialBot?start=pair_1");
    const m2 = buildDeterministicQrMatrix("https://t.me/RayuCodeOfficialBot?start=pair_1");
    expect(m1.length).toBe(21);
    expect(m1[0]?.length).toBe(21);
    expect(m1).toEqual(m2);
    expect(m1[0]?.[0]).toBe(true);
    expect(m1[2]?.[2]).toBe(true);
  });

  it("renders Telegram Bot tab with Hosted QR Pairing, @BotFather form, ApprovalRow decisions, and Remote Uninstall guardrail", async () => {
    renderWithQuery(<RemoteView />);

    await waitFor(() => {
      expect(screen.getByTestId("remote-view")).toBeTruthy();
    });

    expect(screen.getByTestId("tg-status-banner")).toBeTruthy();
    expect(screen.getByTestId("tg-approvals-list")).toBeTruthy();

    // Approve pending tool request via ApprovalRow
    fireEvent.click(
      screen.getByTestId("tg-approval-allow-tg_appr_cargo_bench"),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("tg-approval-status-tg_appr_cargo_bench").textContent,
      ).toContain("Approved via host");
    });

    // Switch to Hosted Pairing QR mode
    const hostedTab = screen.getByTestId("tg-mode-hosted");
    fireEvent.mouseDown(hostedTab);
    fireEvent.click(hostedTab);
    await waitFor(() => {
      expect(screen.getByTestId("tg-qr-matrix")).toBeTruthy();
      expect(screen.getByTestId("tg-pairing-code")).toBeTruthy();
    });

    // Switch to BYO @BotFather Token mode
    const botfatherTab = screen.getByTestId("tg-mode-botfather");
    fireEvent.mouseDown(botfatherTab);
    fireEvent.click(botfatherTab);
    await waitFor(() => {
      expect(screen.getByTestId("tg-byo-token-input")).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId("tg-byo-token-input"), {
      target: { value: "123456789:AAFakeBotFatherToken" },
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

  it("renders Cloud, SSH & Mobile Gateway tab with :7643 WebSocket controls, QR matrix, SSH hosts, and Cloud 26-op sessions", async () => {
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
    expect(screen.getByTestId("gateway-qr-matrix")).toBeTruthy();
    expect(screen.getByTestId("ssh-hosts-list")).toBeTruthy();
    expect(screen.getByTestId("cloud-26-ops-grid").children.length).toBe(26);

    // Start WebSocket Gateway
    fireEvent.click(screen.getByTestId("gateway-toggle-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("gateway-status-badge").textContent).toBe(
        "Enabled",
      );
    });

    // Revoke paired device
    fireEvent.click(screen.getByTestId("gateway-revoke-dev_iphone_16_pro"));
    await waitFor(() => {
      expect(
        screen.queryByTestId("gateway-device-row-dev_iphone_16_pro"),
      ).toBeNull();
    });
  });
});
