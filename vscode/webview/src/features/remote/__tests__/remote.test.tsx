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
});
