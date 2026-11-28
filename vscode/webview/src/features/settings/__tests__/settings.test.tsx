import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VoiceMicButton } from "@/features/composer";
import {
  AccountProvidersSection,
  ALL_57_DEFAULT_PROVIDERS,
  ALL_7_DEFAULT_HOOKS,
  ModelsAgentsSection,
  NATIVE_10_PROVIDERS,
  OPENAI_COMPAT_45_PROVIDERS,
  RuntimeDoctorSection,
  SETTINGS_SECTIONS,
  SettingsView,
} from "@/features/settings";
import * as rpcClient from "@/lib/rpc-client";
import {
  __dispatchHostMessageForTest,
  __setMockAccountStateForTest,
  createQueryClient,
  handleMockHostMessage,
  onHostMessage,
  useAppStore,
} from "@/lib";

function renderWithQuery(ui: React.ReactElement, client = createQueryClient()) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
    ),
  };
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
      activeSettingsSection: "account",
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

  it("wires SettingsView default model selection to canonical config and invalidates composer model-settings", async () => {
    const prevScrollIntoView = Element.prototype.scrollIntoView;
    const prevHasPointerCapture = HTMLElement.prototype.hasPointerCapture;
    Element.prototype.scrollIntoView = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);

    const client = createQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const harnessSpy = vi.spyOn(rpcClient, "sendHarnessRequest");
    const rpcSpy = vi.spyOn(rpcClient, "callRpc");

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
        expect(rpcSpy).toHaveBeenCalledWith("config.patch", {
          patch: { "provider.default_model": "rayu:claude-opus-4-5" },
        });
        expect(harnessSpy).not.toHaveBeenCalled();
        expect(invalidateSpy).toHaveBeenCalledWith(
          expect.objectContaining({ queryKey: ["composer", "model-settings"] }),
        );
      });
    } finally {
      harnessSpy.mockRestore();
      rpcSpy.mockRestore();
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

  it("surfaces visible errors on { ok: false } and rejected Settings and Voice mutations without publishing success, mutating cache, or clearing provider key input", async () => {
    const origCallRpc = rpcClient.callRpc;
    const rpcSpy = vi.spyOn(rpcClient, "callRpc");
    const toastErrorSpy = vi.spyOn(toast, "error");
    const toastSuccessSpy = vi.spyOn(toast, "success");

    rpcSpy.mockImplementation((async (
      method: string,
      params?: Record<string, unknown>,
    ) => {
      if (method === "settings.providers.setApiKey") {
        return {
          ok: false,
          message: "Daemon rejected provider API key",
        };
      }
      if (method === "settings.account.setBypassPacing") {
        return {
          ok: false,
          enabled: false,
          message: "Pacing bypass denied by org policy",
        };
      }
      if (method === "settings.features.set") {
        return {
          ok: false,
          features: {},
          message: "Feature flag update rejected by runtime",
        };
      }
      if (method === "settings.voice.update") {
        throw new Error("Voice capture pipeline unavailable on host");
      }
      return origCallRpc(method as never, params as never);
    }) as typeof rpcClient.callRpc);

    try {
      const { client, unmount } = renderWithQuery(
        <SettingsView initialSection="account" />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("settings-section-account")).toBeTruthy();
      });

      // 1. Provider setApiKey returning { ok: false } retains input and leaves status unchanged (not Ready)
      const statusBefore =
        screen.getByTestId("provider-status-anthropic").textContent;
      fireEvent.click(screen.getByTestId("provider-connect-btn-anthropic"));
      const keyInput = (await screen.findByTestId(
        "provider-key-input-anthropic",
      )) as HTMLInputElement;
      fireEvent.change(keyInput, {
        target: { value: "sk-ant-api03-retained-on-error" },
      });
      fireEvent.click(screen.getByTestId("provider-key-save-anthropic"));

      await waitFor(() => {
        expect(toastErrorSpy).toHaveBeenCalledWith(
          "Daemon rejected provider API key",
        );
      });
      expect(toastSuccessSpy).not.toHaveBeenCalled();
      expect(
        (screen.getByTestId("provider-key-input-anthropic") as HTMLInputElement)
          .value,
      ).toBe("sk-ant-api03-retained-on-error");
      expect(
        screen.getByTestId("provider-status-anthropic").textContent,
      ).toBe(statusBefore);
      expect(
        screen.getByTestId("provider-status-anthropic").textContent,
      ).not.toBe("Ready");

      // 2. Account setBypassPacing returning { ok: false } shows toast.error and does not mutate account cache
      toastErrorSpy.mockClear();
      fireEvent.click(screen.getByTestId("use-all-credits-switch"));
      await waitFor(() => {
        expect(toastErrorSpy).toHaveBeenCalledWith(
          "Pacing bypass denied by org policy",
        );
      });
      const cachedAccount = client.getQueryData<{ bypassPacing?: boolean }>([
        "settings",
        "account",
      ]);
      expect(Boolean(cachedAccount?.bypassPacing)).toBe(false);

      // 3. Features setFeatureFlag returning { ok: false } shows toast.error and does not mutate features cache
      toastErrorSpy.mockClear();
      fireEvent.click(screen.getByTestId("settings-nav-features"));
      await waitFor(() => {
        expect(screen.getByTestId("settings-section-features")).toBeTruthy();
      });
      const beforeFeatures = client.getQueryData<{
        features?: { codemode?: boolean };
      }>(["settings", "features"]);
      const codemodeBefore = Boolean(beforeFeatures?.features?.codemode);
      fireEvent.click(screen.getByTestId("feature-switch-codemode"));
      await waitFor(() => {
        expect(toastErrorSpy).toHaveBeenCalledWith(
          "Feature flag update rejected by runtime",
        );
      });
      const afterFeatures = client.getQueryData<{
        features?: { codemode?: boolean };
      }>(["settings", "features"]);
      expect(Boolean(afterFeatures?.features?.codemode)).toBe(codemodeBefore);
      unmount();

      // 4. VoiceMicButton rolls back recording state, shows visible error when settings.voice.update fails, and gates unsupported voice capture
      toastErrorSpy.mockClear();
      const { unmount: unmountMic } = renderWithQuery(
        <VoiceMicButton supported={true} enabled={false} />,
      );
      const micBtn = screen.getByTestId("voice-mic-btn");
      expect(micBtn.getAttribute("data-recording")).toBe("false");

      fireEvent.click(micBtn);
      await waitFor(() => {
        expect(toastErrorSpy).toHaveBeenCalledWith(
          "Voice capture pipeline unavailable on host",
        );
        expect(micBtn.getAttribute("data-recording")).toBe("false");
      });
      unmountMic();

      renderWithQuery(<VoiceMicButton supported={false} enabled={false} />);
      expect(
        screen.getByTestId("voice-mic-btn").getAttribute("data-supported"),
      ).toBe("false");
    } finally {
      rpcSpy.mockRestore();
      toastErrorSpy.mockRestore();
      toastSuccessSpy.mockRestore();
    }
  });

  it("renders negotiated protocol v1 (or v1.<minor> when supplied) and capabilities in RuntimeDoctorSection without v1.14 fallback, gates unsupported controls, and shows truthful unavailable states", () => {
    const baseRuntimeProps = {
      runtime: {
        socketPath: "/tmp/rayu.sock",
        binaryPath: "/usr/local/bin/rayu",
        autoStart: true,
        transport: "auto" as const,
      },
      telemetry: {
        lockedByEnv: false,
        content: false,
        usage: true,
        crashes: true,
        features: true,
        cost: true,
        accounts: false,
      },
      doctorResults: [],
      selfDevOutput: null,
      onPingDaemon: vi.fn(async () => {}),
      isPingingDaemon: false,
      onReloadDaemonAndBridge: vi.fn(async () => {}),
      isReloadingDaemon: false,
      onReconnectDaemon: vi.fn(async () => {}),
      onOpenOutputLog: vi.fn(async () => {}),
      onUpdateRuntime: vi.fn(async () => {}),
      onRunDoctor: vi.fn(async () => {}),
      isRunningDoctor: false,
      onRunSelfDev: vi.fn(async () => {}),
      isRunningSelfDev: false,
      onSetTelemetry: vi.fn(async () => {}),
      onSubmitFeedback: vi.fn(async () => {}),
    };

    // 1. Connected without server-supplied minor -> renders negotiated "v1" + advertised capabilities (never "v1.14")
    const { unmount: unmountV1 } = renderWithQuery(
      <RuntimeDoctorSection
        {...baseRuntimeProps}
        daemonStatus={{
          state: "connected",
          capabilities: ["permissions", "runtime_commands", "session_tools"],
        }}
      />,
    );
    const cardV1Text =
      screen.getByTestId("runtime-daemon-card").textContent ?? "";
    expect(cardV1Text).toContain("v1");
    expect(cardV1Text).not.toContain("v1.14");
    expect(screen.getByText("permissions")).toBeTruthy();
    expect(screen.getByText("runtime_commands")).toBeTruthy();
    expect(screen.getByText("session_tools")).toBeTruthy();
    expect(
      (screen.getByTestId("selfdev-build-btn") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("selfdev-reload-btn") as HTMLButtonElement).disabled,
    ).toBe(true);
    unmountV1();

    // 2. Connected with server-supplied minor ("1.16") -> renders "v1.16"
    const { unmount: unmountMinor } = renderWithQuery(
      <RuntimeDoctorSection
        {...baseRuntimeProps}
        daemonStatus={{
          state: "connected",
          protocolVersion: "1.16",
          capabilities: ["config_sync"],
        }}
      />,
    );
    expect(
      screen.getByTestId("runtime-daemon-card").textContent,
    ).toContain("v1.16");
    expect(screen.getByText("config_sync")).toBeTruthy();
    unmountMinor();

    // 3. Offline daemon -> renders truthful "Offline" protocol state (never "v1.14")
    const { unmount: unmountOffline } = renderWithQuery(
      <RuntimeDoctorSection
        {...baseRuntimeProps}
        daemonStatus={{
          state: "disconnected",
          capabilities: [],
        }}
      />,
    );
    const offlineText =
      screen.getByTestId("runtime-daemon-card").textContent ?? "";
    expect(offlineText).toContain("Offline");
    expect(offlineText).not.toContain("v1.14");
    unmountOffline();

    // 4. Unavailable analytics read displays "Usage unavailable" instead of live-empty "0 cr total"
    const signedIn = useAppStore.getState().accountStatus!;
    const { unmount: unmountAcct } = renderWithQuery(
      <AccountProvidersSection
        account={signedIn}
        analytics={{
          available: false,
          range: "7d",
          groupBy: "feature",
          totalCredits: 0,
          breakdown: [],
          topSessions: [],
        }}
        analyticsRange="7d"
        onAnalyticsRangeChange={vi.fn()}
        analyticsGroupBy="feature"
        onAnalyticsGroupByChange={vi.fn()}
        providers={NATIVE_10_PROVIDERS}
        onRefreshAccount={vi.fn(async () => {})}
        isRefreshingAccount={false}
        onSignInBrowser={vi.fn(async () => {})}
        onCancelSignIn={vi.fn(async () => {})}
        onSignInApiKey={vi.fn(async () => {})}
        onCompleteCallback={vi.fn(async () => {})}
        onSignOut={vi.fn(async () => {})}
        onSetBypassPacing={vi.fn(async () => {})}
        onSetProviderApiKey={vi.fn(async () => {})}
        onClearProviderApiKey={vi.fn(async () => {})}
        onLogoutProvider={vi.fn(async () => {})}
        onRefreshModels={vi.fn(async () => {})}
        isRefreshingModels={false}
      />,
    );
    const analyticsTab = screen.getByTestId("account-tab-analytics");
    fireEvent.mouseDown(analyticsTab);
    fireEvent.click(analyticsTab);
    expect(
      screen.getByTestId("analytics-breakdown-card").textContent,
    ).toContain("Usage unavailable");
    expect(
      screen.getByTestId("analytics-breakdown-card").textContent,
    ).not.toContain("0 cr total");
    unmountAcct();
  });
});
