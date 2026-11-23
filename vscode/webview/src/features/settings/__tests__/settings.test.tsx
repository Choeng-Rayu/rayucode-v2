import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALL_57_DEFAULT_PROVIDERS,
  ALL_7_DEFAULT_HOOKS,
  NATIVE_10_PROVIDERS,
  OPENAI_COMPAT_45_PROVIDERS,
  SettingsView,
} from "@/features/settings";
import * as rpcClient from "@/lib/rpc-client";
import { createQueryClient, useAppStore } from "@/lib";

function renderWithQuery(ui: React.ReactElement) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("Settings Feature (Wave 3F — Spec 09)", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1280,
    });
    useAppStore.setState({
      surface: "editorPanel",
      route: "settings",
      activeRoute: "settings",
      theme: "auto",
      accent: "green",
      density: "comfortable",
      reduceMotion: false,
    });
  });

  it("includes 10 native provider runtimes, 45 OpenAI-compatible profiles (+2 Enterprise), and 7 lifecycle hooks", () => {
    expect(NATIVE_10_PROVIDERS.length).toBe(10);
    expect(OPENAI_COMPAT_45_PROVIDERS.length).toBe(45);
    expect(ALL_57_DEFAULT_PROVIDERS.length).toBe(57);
    expect(ALL_7_DEFAULT_HOOKS.length).toBe(7);
  });

  it("renders SettingsView shell, Account & Providers section, Plan Ladder, and provider category filters", async () => {
    renderWithQuery(<SettingsView />);

    await waitFor(() => {
      expect(screen.getByTestId("settings-view")).toBeTruthy();
      expect(screen.getByTestId("settings-section-account")).toBeTruthy();
    });

    expect(screen.getByTestId("settings-left-rail")).toBeTruthy();
    expect(screen.getByTestId("settings-daemon-health-pill")).toBeTruthy();

    // Expand Plan Ladder
    fireEvent.click(screen.getByTestId("toggle-plan-ladder-btn"));
    expect(screen.getByTestId("plan-ladder-grid").children.length).toBe(7);

    // Switch provider tabs: Native (10) -> OpenAI-Compatible (45) -> Enterprise (2)
    expect(screen.getByTestId("providers-tab-native").textContent).toContain(
      "Native (10)",
    );
    expect(
      screen.getByTestId("providers-tab-openai-compatible").textContent,
    ).toContain("OpenAI-Compatible (45)");

    fireEvent.click(screen.getByTestId("providers-tab-openai-compatible"));
    expect(screen.getByTestId("provider-row-deepseek")).toBeTruthy();
  });

  it("updates Appearance theme, accent, and density and posts rayucode.ui.setAppearance to host", async () => {
    const postSpy = vi.spyOn(rpcClient, "postToHost");
    renderWithQuery(<SettingsView initialSection="appearance" />);

    await waitFor(() => {
      expect(screen.getByTestId("settings-section-appearance")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("theme-card-light"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "rayucode.ui.setAppearance",
        theme: "light",
      }),
    );

    fireEvent.click(screen.getByTestId("accent-card-blue"));
    expect(document.documentElement.getAttribute("data-accent")).toBe("blue");
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "rayucode.ui.setAppearance",
        accent: "blue",
      }),
    );

    fireEvent.click(screen.getByTestId("density-btn-compact"));
    expect(document.documentElement.getAttribute("data-density")).toBe(
      "compact",
    );

    postSpy.mockRestore();
  });

  it("navigates across Models & Agents, Features & Voice (11 [features] + codemode + integration_tools), Safety & Hooks, Runtime & Doctor, and Shortcuts", async () => {
    renderWithQuery(<SettingsView initialSection="models" />);

    await waitFor(() => {
      expect(screen.getByTestId("settings-section-models")).toBeTruthy();
    });
    expect(screen.getByTestId("role-overrides-list").children.length).toBe(5);
    fireEvent.click(screen.getByTestId("cache-ttl-btn-1h"));

    // Navigate to Features & Voice
    fireEvent.click(screen.getByTestId("settings-nav-features"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-section-features")).toBeTruthy();
    });
    expect(screen.getByTestId("runtime-features-list").children.length).toBe(11);
    expect(screen.getByTestId("feature-switch-codemode")).toBeTruthy();
    expect(screen.getByTestId("feature-switch-integration_tools")).toBeTruthy();
    fireEvent.click(screen.getByTestId("feature-switch-auto_poke"));

    // Navigate to Safety & Hooks
    fireEvent.click(screen.getByTestId("settings-nav-safety"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-section-safety")).toBeTruthy();
    });
    expect(screen.getByTestId("permission-modes-list").children.length).toBe(5);
    expect(screen.getByTestId("lifecycle-hooks-list").children.length).toBe(7);

    // Navigate to Runtime, Bridge & Doctor
    fireEvent.click(screen.getByTestId("settings-nav-runtime"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-section-runtime")).toBeTruthy();
    });
    expect(screen.getByTestId("reload-daemon-bridge-btn")).toBeTruthy();
    expect(screen.getByTestId("telemetry-categories-list").children.length).toBe(
      6,
    );
    fireEvent.click(screen.getByTestId("run-provider-doctor-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("doctor-check-chk_daemon")).toBeTruthy();
    });

    // Navigate to Shortcuts
    fireEvent.click(screen.getByTestId("settings-nav-shortcuts"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-section-shortcuts")).toBeTruthy();
    });
    expect(
      screen.getByTestId("shortcut-kbd-cycle-permission-mode").textContent,
    ).toBe("Shift+Tab");
    expect(
      screen.getByTestId("shortcut-kbd-background-running-tool").textContent,
    ).toBe("Alt+B");
  });
});
