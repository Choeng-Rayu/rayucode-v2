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
  callRpc,
  createQueryClient,
  createStreamBatcher,
  installVsCodePolarityObserver,
  mediaUrl,
  setMediaBaseUri,
  useAppStore,
} from "@/lib";

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

  it("renders Wide Editor Panel AppShell (>=960px) with 6 primary rail items and TopBar", async () => {
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
    expect(screen.getByTestId("rail-nav-swarm")).toBeTruthy();
    expect(screen.getByTestId("rail-nav-automations")).toBeTruthy();
    expect(screen.getByTestId("rail-nav-plugins")).toBeTruthy();
    expect(screen.getByTestId("rail-nav-changes")).toBeTruthy();
    expect(screen.getByTestId("rail-nav-remote")).toBeTruthy();
    expect(screen.getByTestId("stage-child")).toBeTruthy();

    fireEvent.click(screen.getByTestId("rail-nav-swarm"));
    expect(useAppStore.getState().activeRoute).toBe("swarm");
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

  it("renders AuthWelcomeScreen with Rayu Fox hero, Doctor check, and BYOK bypass", async () => {
    const onContinue = vi.fn();
    renderWithQuery(<AuthWelcomeScreen onContinue={onContinue} />);

    expect(screen.getByTestId("auth-welcome-screen")).toBeTruthy();
    fireEvent.click(screen.getByTestId("auth-run-doctor"));

    await waitFor(() => {
      expect(screen.getByText("Rayu Daemon Socket")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Back"));
    fireEvent.click(screen.getByTestId("auth-continue-byok"));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().authBypassed).toBe(true);
  });
});
