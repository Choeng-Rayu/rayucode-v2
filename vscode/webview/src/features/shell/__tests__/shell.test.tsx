import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BrandLogo,
  BRAND_LOGO_KEYS,
  MermaidDiagramSvg,
  NavGlyph,
  RayuProcessingMark,
  TechFileBadge,
  UsageRingSvg,
} from "@/components/ui";
import {
  AppShell,
  AuthWelcomeScreen,
  EMOJI_PRESETS,
  ProjectIconPicker,
  resolveFormFactorFromWidth,
} from "@/features/shell";
import {
  __setMockAccountStateForTest,
  callRpc,
  createQueryClient,
  createStreamBatcher,
  installVsCodePolarityObserver,
  mediaUrl,
  setMediaBaseUri,
  useAppStore,
} from "@/lib";
import * as rpcClient from "@/lib/rpc-client";

function renderWithQuery(ui: React.ReactElement) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("RayuCode VS Code UI Shell & Design System (Wave 2B)", () => {
  beforeEach(() => {
    useAppStore.setState({
      surface: "editorPanel",
      route: "home",
      activeRoute: "home",
      theme: "auto",
      accent: "green",
      sidebarCollapsed: false,
      mobileSidebarOpen: false,
      inspectorOpen: false,
      backgroundDrawerOpen: false,
    });
  });

  it("resolves responsive dual-form-factor breakpoints (<560 compact, 560-959 medium, >=960 wide)", () => {
    expect(resolveFormFactorFromWidth(360)).toBe("compact");
    expect(resolveFormFactorFromWidth(559)).toBe("compact");
    expect(resolveFormFactorFromWidth(560)).toBe("medium");
    expect(resolveFormFactorFromWidth(800)).toBe("medium");
    expect(resolveFormFactorFromWidth(960)).toBe("wide");
    expect(resolveFormFactorFromWidth(1440)).toBe("wide");
  });

  it("renders Wide Editor Panel AppShell (>=960px) with 5 primary rail items matching Desktop and TopBar", async () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1280,
    });

    renderWithQuery(
      <AppShell>
        <div data-testid="stage-child">Hello Workspace</div>
      </AppShell>,
    );

    expect(
      screen.getByTestId("app-shell").getAttribute("data-form-factor"),
    ).toBe("wide");
    expect(screen.getByTestId("rail-nav-home")).toBeTruthy();
    expect(screen.queryByTestId("rail-nav-swarm")).toBeNull();
    expect(screen.getByTestId("rail-nav-automations")).toBeTruthy();
    expect(screen.getByTestId("rail-nav-plugins")).toBeTruthy();
    expect(screen.getByTestId("rail-nav-changes")).toBeTruthy();
    expect(screen.getByTestId("rail-nav-remote")).toBeTruthy();
    expect(screen.getByTestId("stage-child")).toBeTruthy();

    fireEvent.click(screen.getByTestId("rail-nav-automations"));
    expect(useAppStore.getState().activeRoute).toBe("automations");
  });

  it("renders Compact Docked Sidebar AppShell (<560px) with CompactTopBar and slide-over drawers", () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 360,
    });

    renderWithQuery(
      <AppShell>
        <div data-testid="compact-child">Sidebar Chat</div>
      </AppShell>,
    );

    expect(
      screen.getByTestId("app-shell").getAttribute("data-form-factor"),
    ).toBe("compact");
    expect(screen.getByTestId("compact-top-bar")).toBeTruthy();
    expect(screen.getByTestId("compact-expand-editor-panel")).toBeTruthy();

    fireEvent.click(screen.getByTestId("compact-sessions-drawer-trigger"));
    expect(screen.getByTestId("slide-over-sessions-drawer")).toBeTruthy();

    fireEvent.click(screen.getByTestId("compact-inspector-trigger"));
    expect(screen.getByTestId("slide-over-inspector-sheet")).toBeTruthy();
  });

  it("renders all 32 BrandLogo SVGs, RayuProcessingMark, NavGlyph, UsageRingSvg, TechFileBadge, and MermaidDiagramSvg", () => {
    expect(BRAND_LOGO_KEYS.length).toBe(32);

    renderWithQuery(
      <div>
        {BRAND_LOGO_KEYS.map((key) => (
          <BrandLogo key={key} name={key} />
        ))}
        <RayuProcessingMark />
        <NavGlyph icon="home" />
        <UsageRingSvg />
        <TechFileBadge path="src/main.rs" />
        <TechFileBadge path="src/App.tsx" />
        <MermaidDiagramSvg source={"flowchart LR\n  A[Webview] --> B[Host]"} />
      </div>,
    );

    expect(screen.getByText("RS")).toBeTruthy();
    expect(screen.getByText("TX")).toBeTruthy();
  });

  it("constructs ProjectIconPicker 12 emoji presets via String.fromCodePoint and updates selection", () => {
    expect(EMOJI_PRESETS.length).toBe(12);
    const onChange = vi.fn();

    renderWithQuery(
      <ProjectIconPicker
        value={{ iconKind: "icon", iconValue: "folder", iconColor: "folder" }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTestId("project-icon-picker-trigger"));
    fireEvent.click(screen.getByTestId("project-emoji-rocket"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        iconKind: "emoji",
        iconValue: String.fromCodePoint(0x1f680),
      }),
    );
  });

  it("syncs VS Code body polarity classes (vscode-light / vscode-dark / vscode-high-contrast) to root dataset", async () => {
    document.body.className = "vscode-light";
    const unsub = installVsCodePolarityObserver();

    expect(document.documentElement.getAttribute("data-resolved-theme")).toBe(
      "light",
    );

    document.body.className = "vscode-dark vscode-high-contrast";
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-resolved-theme")).toBe(
        "dark",
      );
      expect(document.documentElement.getAttribute("data-hc")).toBe("true");
    });

    unsub();
  });

  it("executes typed RPC calls against mock-vscode-bridge when acquireVsCodeApi is absent", async () => {
    const ping = await callRpc("daemon.ping");
    expect(ping.ok).toBe(true);

    const sessions = await callRpc("sessions.list", { includeArchived: false });
    expect(sessions.sessions.length).toBeGreaterThan(0);

    const created = await callRpc("sessions.create", {
      workingDir: "/workspace/rayucode-v2",
    });
    expect(created.session.sessionId).toMatch(/^ses_/);
  });

  it("batches rapid stream items in createStreamBatcher and resolves mediaUrl paths", () => {
    const flushed: string[][] = [];
    const batcher = createStreamBatcher<string>((items) => {
      flushed.push(items);
    }, 16);

    batcher.push("a");
    batcher.push("b");
    batcher.flushNow();
    expect(flushed).toEqual([["a", "b"]]);
    batcher.dispose();

    setMediaBaseUri("vscode-webview-resource://rayu/media");
    expect(mediaUrl("rayu-fox.png")).toBe(
      "vscode-webview-resource://rayu/media/rayu-fox.png",
    );
  });

  it("renders Desktop-matched AuthWelcomeScreen with browser waiting flow, localhost fallback, cancel, sign-up, manual API key & callback URL, and Open workspace bypass", async () => {
    const postSpy = vi.spyOn(rpcClient, "postToHost");
    const signedOut = __setMockAccountStateForTest({
      signedIn: false,
      authMethod: "none",
      signingIn: false,
      pendingAuthUrl: null,
      pendingMode: null,
      displayName: undefined,
      email: undefined,
      windows: [],
    });
    useAppStore.setState({
      accountStatus: signedOut,
      authLoaded: true,
      authBypassed: false,
      daemonStatus: { state: "connected", capabilities: [] },
    });

    const onContinue = vi.fn();
    renderWithQuery(<AuthWelcomeScreen onContinue={onContinue} />);

    expect(screen.getByTestId("auth-welcome-screen")).toBeTruthy();
    expect(screen.getByText("Welcome to RayuCode")).toBeTruthy();
    expect(screen.getByText("Sign in or create an account")).toBeTruthy();
    // Engine offline strip stays hidden when daemon is connected
    expect(screen.queryByTestId("auth-daemon-offline-strip")).toBeNull();

    // Sign up opens external sign-up page
    fireEvent.click(screen.getByTestId("auth-signup-btn"));
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "rayucode.editor.openExternal",
        url: "https://rayucode.com/sign-up",
      }),
    );

    // Log in -> Waiting state -> Copy sign-in link -> Use localhost fallback -> Cancel
    fireEvent.click(screen.getByTestId("auth-signin-browser"));
    await waitFor(() => {
      expect(screen.getByTestId("auth-waiting-card")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("copy-signin-link-btn"));
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "rayucode.editor.copy",
        text: expect.stringContaining("/vscode-login?state="),
      }),
    );

    fireEvent.click(screen.getByTestId("auth-loopback-fallback-btn"));
    await waitFor(() => {
      expect(
        useAppStore.getState().accountStatus?.pendingAuthUrl ?? "",
      ).toContain("/cli-login?port=");
    });

    fireEvent.click(screen.getByTestId("auth-cancel-signin-btn"));
    await waitFor(() => {
      expect(screen.queryByTestId("auth-waiting-card")).toBeNull();
    });

    // Connect manually: API Key rejects invalid prefix, Get API key opens dashboard, valid key succeeds
    fireEvent.click(screen.getByTestId("auth-switch-apikey"));
    expect(screen.getByTestId("manual-auth-panel")).toBeTruthy();

    fireEvent.click(screen.getByTestId("auth-get-apikey-link"));
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "rayucode.editor.openExternal",
        url: "https://rayucode.com/dashboard/api-keys",
      }),
    );

    fireEvent.change(screen.getByTestId("manual-apikey-input"), {
      target: { value: "invalid_key" },
    });
    fireEvent.click(screen.getByTestId("manual-submit-apikey"));
    expect(await screen.findByTestId("auth-error-message")).toBeTruthy();

    // Callback URL tab accepts vscode:// deep-link callback
    fireEvent.click(screen.getByTestId("manual-tab-callback"));
    fireEvent.change(screen.getByTestId("manual-callback-input"), {
      target: {
        value: "vscode://rayucode.rayucode/auth?code=test_code&state=test_state",
      },
    });
    fireEvent.click(screen.getByTestId("manual-submit-callback"));
    await waitFor(() => {
      expect(useAppStore.getState().accountStatus?.signedIn).toBe(true);
    });
    expect(onContinue).toHaveBeenCalledTimes(1);

    // Open workspace bypass
    fireEvent.click(screen.getByTestId("auth-continue-byok"));
    expect(useAppStore.getState().authBypassed).toBe(true);
    postSpy.mockRestore();
  });

  it("shows compact offline engine strip with Run Doctor only when daemon is disconnected", async () => {
    useAppStore.setState({
      daemonStatus: {
        state: "disconnected",
        capabilities: [],
        error: "Socket unavailable",
      },
    });

    renderWithQuery(<AuthWelcomeScreen />);
    expect(screen.getByTestId("auth-daemon-offline-strip")).toBeTruthy();

    fireEvent.click(screen.getByTestId("auth-run-doctor"));
    await waitFor(() => {
      expect(screen.getByText("Rayu Daemon Socket")).toBeTruthy();
    });
  });
});
