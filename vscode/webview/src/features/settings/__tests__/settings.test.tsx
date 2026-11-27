import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALL_57_DEFAULT_PROVIDERS,
  ALL_7_DEFAULT_HOOKS,
  ModelsAgentsSection,
  NATIVE_10_PROVIDERS,
  OPENAI_COMPAT_45_PROVIDERS,
  SETTINGS_SECTIONS,
  SettingsView,
} from "@/features/settings";
import * as rpcClient from "@/lib/rpc-client";
import {
  __dispatchHostMessageForTest,
  __setMockAccountStateForTest,
  createQueryClient,
  onHostMessage,
  useAppStore,
} from "@/lib";

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
    const signedInAccount = __setMockAccountStateForTest({
      signedIn: true,
      authMethod: "oauth",
      signingIn: false,
      pendingAuthUrl: null,
      pendingMode: null,
      displayName: "Rayu Developer",
      email: "dev@rayucode.com",
      planName: "Plus",
      creditsRemaining: 94_250,
      topUpBalance: 12_000,
      windows: [
        {
          label: "5-hour limit",
          remainingPercent: 86,
          usedPercent: 14,
          resetCountdown: "Resets in 3h 42m",
        },
        {
          label: "Weekly limit",
          remainingPercent: 74,
          usedPercent: 26,
          resetCountdown: "Resets in 4d 11h",
        },
      ],
    });
    useAppStore.setState({
      surface: "editorPanel",
      route: "settings",
      activeRoute: "settings",
      activeSessionId: null,
      theme: "auto",
      accent: "green",
      density: "comfortable",
      reduceMotion: false,
      workbench: {
        openLocation: "secondarySidebar",
        contextActionsAutoSubmit: false,
        showEditorTitleIcon: true,
      },
      accountStatus: signedInAccount,
      authLoaded: true,
    });
  });

  it("includes 10 canonical native provider runtimes (zero fabricated ready/email defaults), 45 OpenAI-compatible profiles (+2 Enterprise), and 7 lifecycle hooks", () => {
    expect(NATIVE_10_PROVIDERS.length).toBe(10);
    expect(NATIVE_10_PROVIDERS.map((p) => p.id)).toEqual([
      "rayu",
      "anthropic",
      "openai",
      "gemini",
      "openrouter",
      "copilot",
      "bedrock",
      "antigravity",
      "cursor",
      "grok",
    ]);
    expect(
      NATIVE_10_PROVIDERS.every(
        (p) => p.status === "needs_key" && !p.accountLabel,
      ),
    ).toBe(true);
    expect(OPENAI_COMPAT_45_PROVIDERS.length).toBe(45);
    expect(ALL_57_DEFAULT_PROVIDERS.length).toBe(57);
    expect(ALL_7_DEFAULT_HOOKS.length).toBe(7);
  });

  it("renders truthful signed-in vs signed-out AccountProvidersSection without fabricated fallbacks and broadcasts rayucode.account.changed on sign out", async () => {
    const receivedChanged: boolean[] = [];
    const unsub = onHostMessage((msg) => {
      if (msg.type === "rayucode.account.changed") {
        receivedChanged.push(msg.account.signedIn);
      }
    });

    renderWithQuery(<SettingsView />);

    await waitFor(() => {
      expect(screen.getByTestId("account-signout-btn")).toBeTruthy();
    });
    expect(screen.getByTestId("account-auth-method-badge").textContent).toBe(
      "Google OAuth",
    );
    expect(screen.getByTestId("account-credits-remaining").textContent).toBe(
      "94,250 cr",
    );

    // Sign out -> clears state, broadcasts account.changed, and shows truthful Not signed in card
    fireEvent.click(screen.getByTestId("account-signout-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("account-signed-out-card")).toBeTruthy();
    });
    expect(receivedChanged).toContain(false);
    expect(useAppStore.getState().accountStatus?.signedIn).toBe(false);
    // ZERO fabricated fallbacks leak into signed-out DOM
    expect(screen.queryByText(/Rayu Developer/)).toBeNull();
    expect(screen.queryByText(/dev@rayucode\.com/)).toBeNull();
    expect(screen.queryByText(/94,250/)).toBeNull();
    expect(screen.queryByText(/Monthly allowance/)).toBeNull();

    // Inline API key connect validates prefix and signs in cleanly
    fireEvent.click(screen.getByTestId("account-connect-apikey-btn"));
    fireEvent.change(screen.getByTestId("account-inline-apikey-input"), {
      target: { value: "bad_key" },
    });
    fireEvent.click(screen.getByTestId("account-inline-apikey-submit"));
    expect(
      await screen.findByTestId("account-inline-apikey-error"),
    ).toBeTruthy();

    fireEvent.change(screen.getByTestId("account-inline-apikey-input"), {
      target: { value: "rayu_sk_live_test_valid_1234567890" },
    });
    fireEvent.click(screen.getByTestId("account-inline-apikey-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("account-signout-btn")).toBeTruthy();
      expect(screen.getByTestId("account-auth-method-badge").textContent).toBe(
        "API Key",
      );
    });
    unsub();
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
    expect(
      screen.getByTestId("shortcut-kbd-open-from-editor-title").textContent,
    ).toBe("Cmd/Ctrl+Alt+R");
    expect(
      screen.getByTestId("shortcut-kbd-open-beside").textContent,
    ).toBe("Cmd/Ctrl+Alt+Shift+R");
    expect(screen.getByTestId("shortcut-row-fix-diagnostic")).toBeTruthy();
    expect(screen.getByTestId("shortcut-row-ask-terminal")).toBeTruthy();
    expect(screen.getByTestId("shortcut-row-scm-open-changes")).toBeTruthy();
  });

  it("updates VS Code Workbench Placement controls in AppearanceSection, posts rayucode.ui.setWorkbench, and reflects workbenchSync", async () => {
    const unsub = onHostMessage((msg) => {
      useAppStore.getState().applyHostMessage(msg);
    });
    const postSpy = vi.spyOn(rpcClient, "postToHost");

    try {
      renderWithQuery(<SettingsView initialSection="appearance" />);

      await waitFor(() => {
        expect(
          screen.getByTestId("appearance-workbench-placement"),
        ).toBeTruthy();
      });

      const secondaryBtn = screen.getByTestId(
        "workbench-open-location-secondarySidebar",
      );
      const besideBtn = screen.getByTestId("workbench-open-location-beside");
      const editorTabBtn = screen.getByTestId(
        "workbench-open-location-editorTab",
      );
      const editorIconSwitch = screen.getByTestId(
        "workbench-editor-title-icon-switch",
      );
      const autoSubmitSwitch = screen.getByTestId(
        "workbench-context-autosubmit-switch",
      );

      expect(secondaryBtn.getAttribute("aria-pressed")).toBe("true");
      expect(editorIconSwitch.getAttribute("aria-checked")).toBe("true");
      expect(autoSubmitSwitch.getAttribute("aria-checked")).toBe("false");

      // Switch openLocation -> beside
      fireEvent.click(besideBtn);
      expect(postSpy).toHaveBeenCalledWith({
        type: "rayucode.ui.setWorkbench",
        openLocation: "beside",
      });
      expect(besideBtn.getAttribute("aria-pressed")).toBe("true");
      expect(useAppStore.getState().workbench.openLocation).toBe("beside");

      // Toggle Live Editor Tab Bar Icon -> false
      fireEvent.click(editorIconSwitch);
      expect(postSpy).toHaveBeenCalledWith({
        type: "rayucode.ui.setWorkbench",
        showEditorTitleIcon: false,
      });
      expect(useAppStore.getState().workbench.showEditorTitleIcon).toBe(false);

      // Toggle Auto-Submit Context Actions -> true
      fireEvent.click(autoSubmitSwitch);
      expect(postSpy).toHaveBeenCalledWith({
        type: "rayucode.ui.setWorkbench",
        contextActionsAutoSubmit: true,
      });
      expect(useAppStore.getState().workbench.contextActionsAutoSubmit).toBe(
        true,
      );

      // Host pushes rayucode.ui.workbenchSync -> UI reflects host state immediately
      __dispatchHostMessageForTest({
        type: "rayucode.ui.workbenchSync",
        workbench: {
          openLocation: "editorTab",
          showEditorTitleIcon: true,
          contextActionsAutoSubmit: false,
        },
      });

      await waitFor(() => {
        expect(editorTabBtn.getAttribute("aria-pressed")).toBe("true");
        expect(editorIconSwitch.getAttribute("aria-checked")).toBe("true");
        expect(autoSubmitSwitch.getAttribute("aria-checked")).toBe("false");
      });

      // Verify appearance search keywords and RuntimeDoctorSection manifest keys
      const appearanceMeta = SETTINGS_SECTIONS.find(
        (s) => s.id === "appearance",
      );
      expect(appearanceMeta?.keywords).toContain("workbench");
      expect(appearanceMeta?.keywords).toContain("secondary sidebar");
      expect(appearanceMeta?.keywords).toContain("auto-submit");

      fireEvent.click(screen.getByTestId("settings-nav-runtime"));
      await waitFor(() => {
        expect(screen.getByTestId("settings-section-runtime")).toBeTruthy();
      });
      expect(screen.getByText(/rayucode\.apiSocketPath/)).toBeTruthy();
      expect(screen.getByText(/rayucode\.binaryPath/)).toBeTruthy();
      expect(screen.getByText(/rayucode\.autoStartBridge/)).toBeTruthy();
    } finally {
      postSpy.mockRestore();
      unsub();
    }
  });

  it("renders live discovered routes in ModelsAgentsSection including arbitrary future Rayu models absent from fallback arrays", async () => {
    const prevScrollIntoView = Element.prototype.scrollIntoView;
    const prevHasPointerCapture = HTMLElement.prototype.hasPointerCapture;
    Element.prototype.scrollIntoView = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);

    try {
      const onSelectDefaultModel = vi.fn();
      renderWithQuery(
        <ModelsAgentsSection
          defaultModel="rayu:rayu-nova-99-ultra"
          defaultEffort="medium"
          serviceTier="auto"
          cacheTtl="5m"
          roleOverrides={[
            {
              role: "swarm",
              label: "Swarm Workers",
              model: "rayu:rayu-nova-99-ultra",
              scope: "global",
            },
          ]}
          routes={[
            {
              id: "gpt-future-8",
              model: "gpt-future-8",
              modelSpec: "gpt-future-8",
              provider: "openai",
              label: "GPT Future 8",
              available: false,
            },
            {
              id: "rayu-nova-99-ultra",
              model: "rayu-nova-99-ultra",
              modelSpec: "rayu:rayu-nova-99-ultra",
              provider: "rayu",
              apiMethod: "rayu",
              label: "Rayu Nova 99 Ultra",
              available: true,
            },
            {
              id: "claude-sonnet-99",
              model: "claude-sonnet-99",
              modelSpec: "rayu:claude-sonnet-99",
              provider: "rayu",
              apiMethod: "rayu",
              label: "Claude Sonnet 99",
              available: true,
            },
          ]}
          onSelectDefaultModel={onSelectDefaultModel}
          onSelectDefaultEffort={vi.fn()}
          onSelectServiceTier={vi.fn(async () => {})}
          onSelectCacheTtl={vi.fn(async () => {})}
          onSetRoleOverride={vi.fn(async () => {})}
          onRefreshModels={vi.fn(async () => {})}
          isRefreshingModels={false}
        />,
      );

      const trigger = screen.getByTestId("default-model-select");
      expect(trigger.textContent).toContain("Rayu Nova 99 Ultra (Rayu Cloud)");

      // Open Select and verify available Rayu future routes appear before unavailable routes
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      await waitFor(() => {
        const options = screen.getAllByRole("option");
        expect(options.map((o) => o.textContent)).toEqual([
          "Rayu Nova 99 Ultra (Rayu Cloud)",
          "Claude Sonnet 99 (Rayu Cloud)",
          "GPT Future 8 (OpenAI)",
        ]);
      });

      fireEvent.click(
        screen.getByRole("option", { name: "Claude Sonnet 99 (Rayu Cloud)" }),
      );
      expect(onSelectDefaultModel).toHaveBeenCalledWith("rayu:claude-sonnet-99");
    } finally {
      Element.prototype.scrollIntoView = prevScrollIntoView;
      HTMLElement.prototype.hasPointerCapture = prevHasPointerCapture;
    }
  });

  it("wires SettingsView default model selection to set_model harness request and invalidates composer model-settings", async () => {
    const prevScrollIntoView = Element.prototype.scrollIntoView;
    const prevHasPointerCapture = HTMLElement.prototype.hasPointerCapture;
    Element.prototype.scrollIntoView = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);

    const client = createQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const harnessSpy = vi.spyOn(rpcClient, "sendHarnessRequest");

    try {
      render(
        <QueryClientProvider client={client}>
          <SettingsView initialSection="models" />
        </QueryClientProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("settings-section-models")).toBeTruthy();
      });

      const trigger = screen.getByTestId("default-model-select");
      expect(trigger.textContent).toContain("Claude Sonnet 4.5 (Rayu Cloud)");

      invalidateSpy.mockClear();
      harnessSpy.mockClear();

      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      await waitFor(() => {
        expect(
          screen.getByRole("option", { name: "Claude Opus 4.5 (Rayu Cloud)" }),
        ).toBeTruthy();
      });

      fireEvent.click(
        screen.getByRole("option", { name: "Claude Opus 4.5 (Rayu Cloud)" }),
      );

      await waitFor(() => {
        expect(harnessSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            req: "set_model",
            model: "rayu:claude-opus-4-5",
          }),
        );
        expect(invalidateSpy).toHaveBeenCalledWith(
          expect.objectContaining({ queryKey: ["composer", "model-settings"] }),
        );
      });
    } finally {
      harnessSpy.mockRestore();
      invalidateSpy.mockRestore();
      Element.prototype.scrollIntoView = prevScrollIntoView;
      HTMLElement.prototype.hasPointerCapture = prevHasPointerCapture;
    }
  });

  it("renders relocated Workspace sections (Agents, Swarm, Automations, Remote) full-bleed inside Settings and returns to active workspace on Back", async () => {
    useAppStore.setState({
      route: "settings",
      activeRoute: "settings",
      activeSettingsSection: "account",
      activeSessionId: "ses_active_chat",
    });

    renderWithQuery(<SettingsView />);

    expect(await screen.findByTestId("settings-nav-agents")).toBeTruthy();
    expect(screen.getByTestId("settings-nav-swarm")).toBeTruthy();
    expect(screen.getByTestId("settings-nav-automations")).toBeTruthy();
    expect(screen.getByTestId("settings-nav-remote")).toBeTruthy();

    fireEvent.click(screen.getByTestId("settings-nav-swarm"));
    expect(await screen.findByTestId("swarm-view")).toBeTruthy();

    fireEvent.click(screen.getByTestId("settings-nav-agents"));
    expect(await screen.findByTestId("agents-view")).toBeTruthy();

    fireEvent.click(screen.getByTestId("settings-nav-automations"));
    expect(await screen.findByTestId("automations-view")).toBeTruthy();

    fireEvent.click(screen.getByTestId("settings-nav-remote"));
    expect(await screen.findByTestId("remote-view")).toBeTruthy();

    fireEvent.click(screen.getByTestId("settings-back-btn"));
    expect(useAppStore.getState().activeRoute).toBe("workspace");
  });

  it("persists default permission mode via settings.permission.setDefault, keeps cards enabled when config.toml is unsupported, and displays catastrophic risk tier", async () => {
    const origCallRpc = rpcClient.callRpc;
    const rpcSpy = vi.spyOn(rpcClient, "callRpc");
    rpcSpy.mockImplementation((async (
      method: string,
      params?: Record<string, unknown>,
    ) => {
      if (method === "config.get") {
        return { supported: false, config: null };
      }
      return origCallRpc(method as never, params as never);
    }) as typeof rpcClient.callRpc);

    renderWithQuery(<SettingsView initialSection="safety" />);

    await waitFor(() => {
      expect(screen.getByTestId("settings-section-safety")).toBeTruthy();
    });

    // Canonical Rust 4th risk tier is "catastrophic"
    expect(screen.getByTestId("risk-tier-catastrophic")).toBeTruthy();

    // All 5 permission mode cards remain clickable even when config.toml configSupported is false
    const acceptEditsCard = screen.getByTestId(
      "permission-mode-card-acceptEdits",
    ) as HTMLButtonElement;
    expect(acceptEditsCard.disabled).toBe(false);
    fireEvent.click(acceptEditsCard);

    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith("settings.permission.setDefault", {
        mode: "acceptEdits",
        applyToActiveSession: false,
      });
    });

    rpcSpy.mockRestore();
  });
});
