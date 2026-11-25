import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type {
  AppRoute,
  BackgroundProcessView,
  DaemonStatusView,
} from "@shared/vscodeProtocol";

import { TooltipProvider } from "@/components/ui";
import {
  __dispatchHostMessageForTest,
  createQueryClient,
  onHostMessage,
  useAppStore,
} from "@/lib";
import { __resetProcessesStateForTest } from "@/features/processes";

import { App } from "../App";

const CONNECTED_DAEMON: DaemonStatusView = {
  state: "connected",
  version: "2.4.0-dev",
  bridgeVersion: "1.14.0",
  protocolVersion: "1.14",
  socketPath: "/run/user/1000/rayu-api.sock",
  latencyMs: 3,
  capabilities: ["sessions", "background", "swarm", "mcp", "telegram"],
};

const SAMPLE_BG_TASK: BackgroundProcessView = {
  taskId: "bg_cargo_test_1",
  sessionId: "ses_vscode_shell",
  group: "shells",
  toolName: "bash",
  displayName: "cargo test -p rayucode-harness-api",
  status: "running",
  progressKind: "determinate",
  percent: 40,
  current: 4,
  total: 10,
  unit: "crates",
  summary: "Compiling rayucode-harness-api...",
  startedAtMs: Date.now() - 8_000,
  updatedAtMs: Date.now() - 1_000,
};

function renderApp() {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <App />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("App end-to-end integration", () => {
  let unsubHostSync: (() => void) | null = null;

  beforeEach(() => {
    __resetProcessesStateForTest();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-resolved-theme");
    document.documentElement.removeAttribute("data-accent");
    document.documentElement.removeAttribute("data-hc");
    document.body.className = "vscode-dark";

    useAppStore.setState({
      surface: "editorPanel",
      route: "home",
      activeRoute: "home",
      activeSessionId: "ses_vscode_shell",
      activeSessionTitle: "Build VS Code dual-form-factor shell",
      theme: "auto",
      resolvedTheme: "dark",
      accent: "green",
      density: "comfortable",
      reduceMotion: false,
      daemonStatus: CONNECTED_DAEMON,
      authLoaded: true,
      authBypassed: false,
      authDialogOpen: false,
      inspectorOpen: false,
      mobileSidebarOpen: false,
      sidebarCollapsed: false,
      backgroundDrawerOpen: false,
      backgroundTasks: [],
      editorSelection: null,
      pendingComposerInjection: null,
      composerDrafts: {},
      workbench: {
        openLocation: "secondarySidebar",
        contextActionsAutoSubmit: false,
        showEditorTitleIcon: true,
      },
      activeProjectPath: "/workspace/rayucode-v2",
      workspaces: [
        {
          name: "rayucode-v2",
          path: "/workspace/rayucode-v2",
          branch: "main",
          isPrimary: true,
        },
        {
          name: "rayu-cloud-api",
          path: "/workspace/rayu-cloud-api",
          branch: "feat/kv-cache",
        },
      ],
      isStreamActive: false,
      pendingUserTurn: null,
    });

    // Mirror main.tsx bootstrap host message synchronization once per test
    unsubHostSync = onHostMessage((msg) => {
      useAppStore.getState().applyHostMessage(msg);
    });
  });

  afterEach(() => {
    unsubHostSync?.();
    unsubHostSync = null;
    cleanup();
  });

  it(
    "mounts Home route and navigates cleanly across all 8 AppRoutes",
    async () => {
      renderApp();

      // 1. Home
      expect(await screen.findByTestId("home-page")).toBeTruthy();
      expect(screen.getByTestId("app-shell").getAttribute("data-route")).toBe(
        "home",
      );

      const routes: Array<{ route: AppRoute; testId: string }> = [
        { route: "workspace", testId: "chat-workspace-view" },
        { route: "swarm", testId: "swarm-view" },
        { route: "automations", testId: "automations-view" },
        { route: "plugins", testId: "plugins-view" },
        { route: "changes", testId: "changes-view" },
        { route: "remote", testId: "remote-view" },
        { route: "settings", testId: "settings-view" },
      ];

      for (const { route, testId } of routes) {
        act(() => {
          __dispatchHostMessageForTest({
            type: "rayucode.ui.navigate",
            route,
            sessionId: "ses_vscode_shell",
          });
        });

        await waitFor(
          () => {
            expect(screen.getByTestId(testId)).toBeTruthy();
          },
          { timeout: 10_000 },
        );
        expect(screen.getByTestId("app-shell").getAttribute("data-route")).toBe(
          route,
        );
      }
    },
    20_000,
  );

  it("renders BackgroundDockBar on snapshot push and toggles BackgroundProcessDrawer", async () => {
    renderApp();
    expect(await screen.findByTestId("home-page")).toBeTruthy();

    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.processes.snapshot",
        tasks: [SAMPLE_BG_TASK],
      });
    });

    const dock = await screen.findByTestId("background-dock-bar");
    expect(dock).toBeTruthy();

    // Open drawer via host navigate flag
    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.ui.navigate",
        route: "workspace",
        sessionId: "ses_vscode_shell",
        openProcessesDrawer: true,
      });
    });

    expect(await screen.findByTestId("background-drawer-host")).toBeTruthy();
    expect(await screen.findByTestId("background-process-drawer")).toBeTruthy();
  });

  it("applies host init, appearanceSync (theme + accent), and editor selection updates", async () => {
    renderApp();
    expect(await screen.findByTestId("home-page")).toBeTruthy();

    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.host.init",
        surface: "sidebar",
        mediaBaseUri: "vscode-webview-resource://media",
        theme: "light",
        accent: "blue",
        density: "compact",
        reduceMotion: true,
        route: "workspace",
        sessionId: "ses_vscode_shell",
        capabilities: ["sessions", "background"],
        daemonStatus: CONNECTED_DAEMON,
        workspaces: [
          {
            name: "rayucode-v2",
            path: "/workspace/rayucode-v2",
            branch: "main",
            isPrimary: true,
          },
        ],
        editorSelection: {
          filePath: "/workspace/rayucode-v2/crates/rayu-harness/src/lookup.rs",
          relativePath: "crates/rayu-harness/src/lookup.rs",
          languageId: "rust",
          lineStart: 12,
          lineEnd: 28,
          lineCount: 17,
        },
        backgroundTasks: [],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("chat-workspace-view")).toBeTruthy();
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.getAttribute("data-accent")).toBe("blue");
    expect(document.documentElement.getAttribute("data-density")).toBe(
      "compact",
    );
    expect(useAppStore.getState().surface).toBe("sidebar");
    expect(useAppStore.getState().editorSelection?.relativePath).toBe(
      "crates/rayu-harness/src/lookup.rs",
    );

    // Switch back via appearanceSync
    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.ui.appearanceSync",
        theme: "dark",
        accent: "green",
      });
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-accent")).toBe("green");
  });

  it("preserves theme when changing accent and preserves accent when changing theme in mock bridge", async () => {
    renderApp();
    expect(await screen.findByTestId("home-page")).toBeTruthy();

    act(() => {
      useAppStore.getState().setTheme("light");
    });
    expect(useAppStore.getState().theme).toBe("light");

    act(() => {
      useAppStore.getState().setAccent("blue");
    });
    expect(useAppStore.getState().theme).toBe("light");
    expect(useAppStore.getState().accent).toBe("blue");

    act(() => {
      useAppStore.getState().setTheme("dark");
    });
    expect(useAppStore.getState().theme).toBe("dark");
    expect(useAppStore.getState().accent).toBe("blue");
  });

  it("handles focusComposer and resumeSession host commands and renders optimistic turns on workspace submit", async () => {
    renderApp();
    expect(await screen.findByTestId("home-page")).toBeTruthy();

    // resumeSession opens session search & expands sidebar
    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.host.command",
        command: "resumeSession",
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("sidebar-search-input")).toBeTruthy();
    });

    // focusComposer navigates to workspace when activeSessionId is set
    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.host.command",
        command: "focusComposer",
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("chat-workspace-view")).toBeTruthy();
    });

    // Submitting in workspace creates an immediate optimistic user turn in ChatStream
    const textarea = screen.getByTestId("composer-textarea");
    fireEvent.change(textarea, {
      target: { value: "Verify optimistic live user prompt rendering" },
    });
    fireEvent.click(screen.getByTestId("composer-submit-btn"));

    await waitFor(() => {
      expect(
        screen.getByText("Verify optimistic live user prompt rendering"),
      ).toBeTruthy();
    });
  });

  it("renders Right Inspector diff and browser tabs cleanly and shows close button in compact sheet mode", async () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 340,
    });

    renderApp();
    expect(await screen.findByTestId("home-page")).toBeTruthy();

    // Open compact inspector sheet in context mode
    fireEvent.click(screen.getByTestId("compact-inspector-trigger"));
    expect(screen.getByTestId("slide-over-inspector-sheet")).toBeTruthy();
    const closeBtn = screen.getByTestId("inspector-sheet-close-btn");
    expect(closeBtn).toBeTruthy();

    // Switch to Simple Browser tab -> renders browser view without stale code header
    fireEvent.click(screen.getByTestId("inspector-strip-browser"));
    expect(await screen.findByTestId("inspector-browser-view")).toBeTruthy();

    // Return from document mode to context mode, then switch to Changes & Diff tab
    fireEvent.click(screen.getByLabelText("Close document"));
    fireEvent.click(screen.getByTestId("inspector-strip-diff"));
    await waitFor(() => {
      expect(screen.getByTestId("changes-view")).toBeTruthy();
    });

    // Restore window width for subsequent tests
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1280,
    });
  });

  it("renders AuthWelcomeScreen when daemon is offline and allows BYOK bypass", async () => {
    useAppStore.setState({
      daemonStatus: {
        state: "disconnected",
        capabilities: [],
        error: "Bridge socket not reachable",
      },
      authBypassed: false,
    });

    renderApp();
    expect(await screen.findByTestId("rayu-offline-gate")).toBeTruthy();
    expect(screen.getByTestId("auth-welcome-screen")).toBeTruthy();

    fireEvent.click(screen.getByTestId("auth-continue-byok"));

    expect(await screen.findByTestId("app-shell")).toBeTruthy();
    expect(await screen.findByTestId("home-page")).toBeTruthy();
  });

  it("opens AuthWelcomeScreen when authDialogOpen is triggered and closes it automatically on rayucode.account.changed sign-in", async () => {
    useAppStore.setState({
      accountStatus: {
        signedIn: false,
        authMethod: "none",
        windows: [],
      },
      authLoaded: true,
      authBypassed: false,
      authDialogOpen: true,
    });

    renderApp();
    expect(await screen.findByTestId("rayu-auth-gate")).toBeTruthy();
    expect(screen.getByTestId("auth-welcome-screen")).toBeTruthy();

    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.account.changed",
        account: {
          signedIn: true,
          authMethod: "oauth",
          displayName: "Rayu Developer",
          email: "dev@rayucode.com",
          planName: "Plus",
          windows: [],
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("app-shell")).toBeTruthy();
      expect(screen.getByTestId("home-page")).toBeTruthy();
    });
    expect(useAppStore.getState().authDialogOpen).toBe(false);
    expect(useAppStore.getState().accountStatus?.signedIn).toBe(true);
  });

  it("gates VS Code webview behind AuthWelcomeScreen when signed out and allows Open workspace bypass", async () => {
    const prevAcquire = window.acquireVsCodeApi;
    window.acquireVsCodeApi = () => ({
      postMessage: () => {},
      getState: () => undefined,
      setState: () => {},
    });

    try {
      useAppStore.setState({
        accountStatus: {
          signedIn: false,
          authMethod: "none",
          windows: [],
        },
        authLoaded: true,
        authBypassed: false,
        authDialogOpen: false,
      });

      renderApp();
      expect(await screen.findByTestId("rayu-auth-gate")).toBeTruthy();
      expect(screen.getByTestId("auth-welcome-screen")).toBeTruthy();

      fireEvent.click(screen.getByTestId("auth-continue-byok"));
      expect(await screen.findByTestId("app-shell")).toBeTruthy();
      expect(useAppStore.getState().authBypassed).toBe(true);
    } finally {
      window.acquireVsCodeApi = prevAcquire;
    }
  });

  it("keeps compact sessions drawer close button non-overlapping and closes drawer on nav clicks", async () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 340,
    });

    const postSpy = vi.fn();
    renderApp();
    expect(await screen.findByTestId("home-page")).toBeTruthy();

    fireEvent.click(screen.getByTestId("compact-sessions-drawer-trigger"));
    expect(screen.getByTestId("slide-over-sessions-drawer")).toBeTruthy();
    expect(screen.getByTestId("close-sessions-drawer-btn")).toBeTruthy();

    // Clicking nav item inside compact drawer closes the slide-over
    expect(screen.queryByTestId("rail-nav-swarm")).toBeNull();
    fireEvent.click(screen.getByTestId("rail-nav-automations"));
    await waitFor(() => {
      expect(screen.queryByTestId("slide-over-sessions-drawer")).toBeNull();
    });
    expect(useAppStore.getState().activeRoute).toBe("automations");
    expect(postSpy).not.toHaveBeenCalled();

    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1280,
    });
  });

  it("handles rayucode.composer.inject across both home (controlled) and workspace (uncontrolled) routes and hydrates workbench prefs", async () => {
    // 1. Home route (no activeSessionId -> controlled HomePage composer)
    useAppStore.setState({
      activeSessionId: null,
      activeSessionTitle: null,
      route: "settings",
      activeRoute: "settings",
    });

    renderApp();
    expect(await screen.findByTestId("settings-view")).toBeTruthy();

    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.composer.inject",
        injection: {
          id: "inj_app_home_1",
          mentions: ["src/index.ts", "src/helper.ts"],
          prompt: "Explain how these modules interact",
          workingDir: "/workspace/rayu-cloud-api",
          autoSubmit: false,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("home-page")).toBeTruthy();
      const textarea = screen.getByTestId(
        "composer-textarea",
      ) as HTMLTextAreaElement;
      expect(textarea.value).toBe(
        "@src/index.ts @src/helper.ts\n\nExplain how these modules interact",
      );
    });
    expect(useAppStore.getState().activeProjectPath).toBe(
      "/workspace/rayu-cloud-api",
    );
    expect(useAppStore.getState().pendingComposerInjection).toBeNull();

    // 2. Workspace route (activeSessionId present -> switches from settings to uncontrolled SessionComposer)
    act(() => {
      useAppStore.setState({
        activeSessionId: "ses_vscode_shell",
        activeSessionTitle: "Build VS Code dual-form-factor shell",
        route: "settings",
        activeRoute: "settings",
      });
    });
    expect(await screen.findByTestId("settings-view")).toBeTruthy();

    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.composer.inject",
        injection: {
          id: "inj_app_ws_2",
          mentions: ["crates/rayu-harness/src/lib.rs"],
          prompt: "Fix compiler warning",
          selection: {
            filePath: "/workspace/rayucode-v2/crates/rayu-harness/src/lib.rs",
            relativePath: "crates/rayu-harness/src/lib.rs",
            languageId: "rust",
            lineStart: 5,
            lineEnd: 15,
            lineCount: 11,
          },
          autoSubmit: false,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("chat-workspace-view")).toBeTruthy();
      const textarea = screen.getByTestId(
        "composer-textarea",
      ) as HTMLTextAreaElement;
      expect(textarea.value).toBe(
        "@crates/rayu-harness/src/lib.rs\n\nFix compiler warning",
      );
    });
    expect(screen.getByTestId("active-selection-pill")).toBeTruthy();
    expect(useAppStore.getState().pendingComposerInjection).toBeNull();

    // 3. Workbench sync from host updates store cleanly
    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.ui.workbenchSync",
        workbench: {
          openLocation: "beside",
          contextActionsAutoSubmit: true,
          showEditorTitleIcon: false,
        },
      });
    });
    expect(useAppStore.getState().workbench).toEqual({
      openLocation: "beside",
      contextActionsAutoSubmit: true,
      showEditorTitleIcon: false,
    });
  });

  it("preserves pendingComposerInjection across AuthWelcomeScreen gate until user bypasses/signs in", async () => {
    useAppStore.setState({
      activeSessionId: null,
      activeSessionTitle: null,
      daemonStatus: {
        state: "disconnected",
        capabilities: [],
        error: "Bridge offline",
      },
      authBypassed: false,
    });

    renderApp();
    expect(await screen.findByTestId("rayu-offline-gate")).toBeTruthy();

    // Host injects context while composer is unmounted behind AuthWelcomeScreen
    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.composer.inject",
        injection: {
          id: "inj_behind_gate_1",
          mentions: ["src/auth.ts"],
          prompt: "Explain this error after bypass",
          autoSubmit: false,
        },
      });
    });

    // Injection remains queued in Zustand because composer is not mounted yet
    expect(useAppStore.getState().pendingComposerInjection?.id).toBe(
      "inj_behind_gate_1",
    );

    // User bypasses auth/offline gate -> Home mounts and immediately consumes the queued injection
    fireEvent.click(screen.getByTestId("auth-continue-byok"));

    await waitFor(() => {
      expect(screen.getByTestId("home-page")).toBeTruthy();
      const textarea = screen.getByTestId(
        "composer-textarea",
      ) as HTMLTextAreaElement;
      expect(textarea.value).toBe(
        "@src/auth.ts\n\nExplain this error after bypass",
      );
    });
    expect(useAppStore.getState().pendingComposerInjection).toBeNull();
  });

  it("invalidates all composer & settings model/provider queries on rayucode.account.changed and rayucode.daemon.statusChanged (connected)", async () => {
    const client = createQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    render(
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={0}>
          <App />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId("home-page")).toBeTruthy();

    invalidateSpy.mockClear();
    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.account.changed",
        account: {
          signedIn: true,
          authMethod: "oauth",
          displayName: "Rayu Developer",
          email: "dev@rayucode.com",
          planName: "Plus",
          windows: [],
        },
      });
    });

    const expectedModelAndProviderKeys = [
      ["composer", "model-settings"],
      ["composer", "providers"],
      ["settings", "models"],
      ["settings", "providers"],
      ["models"],
    ];

    for (const key of expectedModelAndProviderKeys) {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: key }),
      );
    }

    invalidateSpy.mockClear();
    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.daemon.statusChanged",
        status: {
          ...CONNECTED_DAEMON,
          state: "reconnecting",
        },
      });
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.daemon.statusChanged",
        status: CONNECTED_DAEMON,
      });
    });
    for (const key of expectedModelAndProviderKeys) {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: key }),
      );
    }

    invalidateSpy.mockRestore();
  });
});
