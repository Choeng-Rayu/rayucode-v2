import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SettingsView } from "@/features/settings";
import {
  __dispatchHostMessageForTest,
  __resetMockV116StateForTest,
  __setMockAccountStateForTest,
  __setMockV116StateForTest,
  createQueryClient,
  useAppStore,
} from "@/lib";

function renderSettings(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>,
  );
}

describe("Settings v1.16 ~/.rayu/config.toml sync, validation & v1.15 fallback", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1280,
    });
    const signedIn = __setMockAccountStateForTest({
      signedIn: true,
      authMethod: "oauth",
      displayName: "Rayu Developer",
    });
    useAppStore.setState({
      surface: "editorPanel",
      route: "settings",
      activeRoute: "settings",
      theme: "auto",
      accent: "green",
      density: "comfortable",
      reduceMotion: false,
      accountStatus: signedIn,
      authLoaded: true,
    });
  });

  afterEach(() => {
    __resetMockV116StateForTest();
  });

  it("shows Synced with ~/.rayu/config.toml vs Local to VS Code badges, Reload required badge, and restart banner on restart_required patch", async () => {
    renderSettings(<SettingsView initialSection="features" />);

    await waitFor(() => {
      expect(screen.getByTestId("settings-section-features")).toBeTruthy();
    });

    // Synced scope badge on engine features + Local badge on voice card
    expect(
      screen.getByTestId("settings-scope-badge-synced").textContent,
    ).toContain("Synced with ~/.rayu/config.toml");
    expect(
      screen.getByTestId("settings-scope-badge-local").textContent,
    ).toContain("Local to VS Code");

    // Reload required badge appears on features.swarm (apply_mode === "restart_required")
    await waitFor(() => {
      const reloadBadges = screen.getAllByTestId("field-reload-required-badge");
      expect(reloadBadges.length).toBeGreaterThan(0);
    });

    // Toggling features.swarm patches config.toml and shows post-patch restart banner
    const swarmSwitch = screen.getByTestId("feature-switch-swarm");
    fireEvent.click(swarmSwitch);

    await waitFor(() => {
      expect(screen.getByTestId("settings-restart-banner")).toBeTruthy();
      expect(
        screen.getByTestId("settings-restart-banner").textContent,
      ).toContain("Reload the Rayu daemon to apply updated settings.");
    });
  });

  it("renders per-field inline validation error without faking success when config.patch rejects", async () => {
    __setMockV116StateForTest({
      rejectPatchKeys: {
        "features.memory": "Memory feature is locked by workspace policy.",
      },
    });

    renderSettings(<SettingsView initialSection="features" />);

    await waitFor(() => {
      expect(screen.getByTestId("feature-switch-memory")).toBeTruthy();
    });

    const memorySwitch = screen.getByTestId("feature-switch-memory");
    expect(memorySwitch.getAttribute("data-state")).toBe("checked");

    fireEvent.click(memorySwitch);

    await waitFor(() => {
      const err = screen.getByTestId("field-error-features.memory");
      expect(err.textContent).toContain(
        "Memory feature is locked by workspace policy.",
      );
    });

    // Control was NOT faked to unchecked
    expect(memorySwitch.getAttribute("data-state")).toBe("checked");

    // Dismiss error cleanly
    fireEvent.click(screen.getByTestId("field-error-dismiss-features.memory"));
    expect(screen.queryByTestId("field-error-features.memory")).toBeNull();
  });

  it("refreshes live controls when rayucode.config.changed arrives from CLI/Desktop", async () => {
    renderSettings(<SettingsView initialSection="features" />);

    await waitFor(() => {
      expect(screen.getByTestId("feature-switch-auto_poke")).toBeTruthy();
    });

    const autoPoke = screen.getByTestId("feature-switch-auto_poke");
    expect(autoPoke.getAttribute("data-state")).toBe("unchecked");

    __dispatchHostMessageForTest({
      type: "rayucode.config.changed",
      changedKeys: ["features.auto_poke"],
      requiresRestart: false,
      values: { "features.auto_poke": true },
    });

    await waitFor(() => {
      expect(autoPoke.getAttribute("data-state")).toBe("checked");
      expect(screen.getByTestId("settings-status-banner").textContent).toContain(
        "Synced update from ~/.rayu/config.toml",
      );
    });
  });

  it("degrades gracefully on older v1.15 daemons: shows read-only info banner while keeping Local UI Preferences editable", async () => {
    __setMockV116StateForTest({ configSupported: false });

    renderSettings(<SettingsView initialSection="features" />);

    await waitFor(() => {
      const banner = screen.getByTestId("settings-legacy-v115-banner");
      expect(banner.textContent).toContain(
        "Connected to an older Rayu daemon (v1.15)",
      );
    });

    // Synced engine switch is disabled
    const swarmSwitch = screen.getByTestId(
      "feature-switch-swarm",
    ) as HTMLButtonElement;
    expect(swarmSwitch.disabled).toBe(true);

    // Local Voice switch remains interactive
    const voiceSwitch = screen.getByTestId(
      "voice-enabled-switch",
    ) as HTMLButtonElement;
    expect(voiceSwitch.disabled).toBe(false);

    // Navigate to Appearance -> Local to VS Code badge and theme cards remain 100% interactive
    fireEvent.click(screen.getByTestId("settings-nav-appearance"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-section-appearance")).toBeTruthy();
      expect(
        screen.getByTestId("settings-scope-badge-local").textContent,
      ).toContain("Local to VS Code");
    });
    const darkCard = screen.getByTestId("theme-card-dark") as HTMLButtonElement;
    expect(darkCard.disabled).toBe(false);
    fireEvent.click(darkCard);
    expect(useAppStore.getState().theme).toBe("dark");
  });
});
