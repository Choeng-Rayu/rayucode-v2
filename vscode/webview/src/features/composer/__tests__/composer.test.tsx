import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __dispatchHostMessageForTest,
  createQueryClient,
  setMediaBaseUri,
  useAppStore,
} from "@/lib";

import {
  ActiveSelectionPill,
  EFFORT_STOPS,
  HomePage,
  ModelEffortPopover,
  PermissionPopover,
  SessionComposer,
} from "../index";

function renderWithQuery(ui: React.ReactElement) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("RayuCode VS Code Home & Composer Feature (Wave 3A, Spec 01)", () => {
  beforeEach(() => {
    setMediaBaseUri("vscode-webview-resource://rayu-ext/media");
    useAppStore.setState({
      surface: "editorPanel",
      route: "home",
      activeRoute: "home",
      activeSessionId: null,
      activeSessionTitle: null,
      editorSelection: null,
      isStreamActive: false,
      capabilities: ["sessions", "voice", "skills"],
    });
  });

  it("renders HomePage with mediaUrl('rayu-fox.png'), serif italic 'next?' headline, 4 quick-action pills, and recent sessions preview", async () => {
    renderWithQuery(<HomePage userName="Rayu" />);

    const heroLogo = screen.getByTestId("home-hero-logo") as HTMLImageElement;
    expect(heroLogo.getAttribute("src")).toBe(
      "vscode-webview-resource://rayu-ext/media/rayu-fox.png",
    );

    const headline = screen.getByTestId("home-hero-headline");
    expect(headline.textContent).toContain("What shall we build");
    expect(headline.textContent).toContain("next?");
    const italicAccent = headline.querySelector("em");
    expect(italicAccent?.textContent).toBe("next?");

    // 4 quiet quick-action pills populate the composer textarea on click
    const explainBtn = screen.getByTestId("quick-action-explain-selection");
    const fixTestBtn = screen.getByTestId("quick-action-fix-test-failure");
    const reviewDiffBtn = screen.getByTestId("quick-action-review-git-diff");
    const launchSwarmBtn = screen.getByTestId("quick-action-launch-swarm");
    expect(explainBtn).toBeTruthy();
    expect(fixTestBtn).toBeTruthy();
    expect(reviewDiffBtn).toBeTruthy();
    expect(launchSwarmBtn).toBeTruthy();

    fireEvent.click(reviewDiffBtn);
    const textarea = screen.getByTestId(
      "composer-textarea",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toContain("/review");

    // Recent sessions strip loads from mock RPC
    await waitFor(() => {
      expect(screen.getByTestId("home-recent-sessions")).toBeTruthy();
    });
  });

  it("cycles through all 5 PermissionPopover modes via Shift+Tab keyboard shortcut", () => {
    const onChange = vi.fn();
    const Wrapper = () => {
      const [mode, setMode] = React.useState<
        "default" | "acceptEdits" | "plan" | "fullManage" | "orchestrator"
      >("default");
      return (
        <PermissionPopover
          value={mode}
          onChange={(next) => {
            setMode(next);
            onChange(next);
          }}
        />
      );
    };

    renderWithQuery(<Wrapper />);

    expect(screen.getByTestId("permission-mode-label").textContent).toBe("Ask");

    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith("acceptEdits");
    expect(screen.getByTestId("permission-mode-label").textContent).toBe(
      "Auto-edit",
    );

    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith("plan");
    expect(screen.getByTestId("permission-mode-label").textContent).toBe("Plan");

    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith("fullManage");
    expect(screen.getByTestId("permission-mode-label").textContent).toBe(
      "Full Manage",
    );

    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith("orchestrator");
    expect(screen.getByTestId("permission-mode-label").textContent).toBe(
      "Orchestrator",
    );

    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith("default");
    expect(screen.getByTestId("permission-mode-label").textContent).toBe("Ask");
  });

  it("supports all 5 reasoning effort stops (low | medium | high | xhigh | max), service tier, cache TTL, and Stage 2 model selection", () => {
    expect(EFFORT_STOPS.map((s) => s.level)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);

    const onSelectModel = vi.fn();
    const onSelectEffort = vi.fn();
    const onSelectServiceTier = vi.fn();
    const onSelectCacheTtl = vi.fn();

    const Wrapper = () => {
      const [effort, setEffort] = React.useState<
        "low" | "medium" | "high" | "xhigh" | "max"
      >("medium");
      return (
        <ModelEffortPopover
          defaultOpen
          modelId="claude-opus-5-5"
          modelLabel="Claude Opus 5.5"
          effort={effort}
          onSelectModel={onSelectModel}
          onSelectEffort={(next) => {
            setEffort(next);
            onSelectEffort(next);
          }}
          onSelectServiceTier={onSelectServiceTier}
          onSelectCacheTtl={onSelectCacheTtl}
        />
      );
    };

    renderWithQuery(<Wrapper />);

    expect(screen.getByTestId("effort-level-value").textContent).toBe("Medium");

    // Click each of the 5 stops
    fireEvent.click(screen.getByLabelText("Low"));
    expect(onSelectEffort).toHaveBeenLastCalledWith("low");
    expect(screen.getByTestId("effort-level-value").textContent).toBe("Low");

    fireEvent.click(screen.getByLabelText("High"));
    expect(onSelectEffort).toHaveBeenLastCalledWith("high");
    expect(screen.getByTestId("effort-level-value").textContent).toBe("High");

    fireEvent.click(screen.getByLabelText("Extra High"));
    expect(onSelectEffort).toHaveBeenLastCalledWith("xhigh");
    expect(screen.getByTestId("effort-level-value").textContent).toBe("Extra High");

    fireEvent.click(screen.getByLabelText("Max"));
    expect(onSelectEffort).toHaveBeenLastCalledWith("max");
    expect(screen.getByTestId("effort-level-value").textContent).toBe("Max");

    // Service tier & Cache TTL selectors
    fireEvent.click(screen.getByTestId("service-tier-priority"));
    expect(onSelectServiceTier).toHaveBeenCalledWith("priority");

    fireEvent.click(screen.getByTestId("cache-ttl-1h"));
    expect(onSelectCacheTtl).toHaveBeenCalledWith("1h");

    // Switch to Stage 2 model list and select a model
    fireEvent.click(screen.getByTestId("open-model-list-btn"));
    expect(screen.getByTestId("model-list-card")).toBeTruthy();

    const sonnetOption = screen.getByRole("option", {
      name: /Claude Sonnet 4\.5/i,
    });
    fireEvent.click(sonnetOption);
    expect(onSelectModel).toHaveBeenCalledWith(
      expect.objectContaining({ id: "claude-sonnet-4-5" }),
    );
  });

  it("opens @file MentionMenu when typing @query and inserts selected file into SessionComposer", async () => {
    renderWithQuery(<SessionComposer mode="workspace" />);

    const textarea = screen.getByTestId(
      "composer-textarea",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Inspect @globals" } });

    await waitFor(() => {
      expect(screen.getByTestId("mention-menu")).toBeTruthy();
    });

    const items = screen.getAllByTestId("mention-item");
    expect(items.length).toBeGreaterThan(0);
    fireEvent.click(items[0]);

    expect(textarea.value).toContain(
      "Inspect @vscode/webview/src/styles/globals.css ",
    );
  });

  it("renders ActiveSelectionPill with file:L10-L42 when editorSelection is active in useAppStore, supporting toggle and dismiss", () => {
    useAppStore.getState().setEditorSelection({
      filePath: "/workspace/rayucode-v2/src/harnessSession.ts",
      relativePath: "src/harnessSession.ts",
      languageId: "typescript",
      lineStart: 10,
      lineEnd: 42,
      lineCount: 33,
      selectedText: "export class HarnessSession {}",
    });

    renderWithQuery(<ActiveSelectionPill />);

    const pill = screen.getByTestId("active-selection-pill");
    expect(pill.getAttribute("data-included")).toBe("true");
    expect(screen.getByTestId("active-selection-label").textContent).toBe(
      "harnessSession.ts:L10-L42",
    );

    // Toggle include/exclude state
    fireEvent.click(screen.getByTestId("active-selection-toggle"));
    expect(pill.getAttribute("data-included")).toBe("false");

    fireEvent.click(screen.getByTestId("active-selection-toggle"));
    expect(pill.getAttribute("data-included")).toBe("true");

    // Dismiss clears editorSelection from store
    fireEvent.click(screen.getByTestId("active-selection-dismiss"));
    expect(useAppStore.getState().editorSelection).toBeNull();
  });

  it("emits standardized req discriminant for set_reasoning_effort and set_model without duplicate permission harness frames", () => {
    const posted: unknown[] = [];
    window.acquireVsCodeApi = () => ({
      postMessage: (msg: unknown) => posted.push(msg),
      getState: () => undefined,
      setState: () => undefined,
    });

    const onSelectModel = vi.fn();
    const onSelectEffort = vi.fn();
    const onPermChange = vi.fn();

    renderWithQuery(
      <div>
        <ModelEffortPopover
          defaultOpen
          sessionId="ses_live_1"
          modelId="claude-opus-5-5"
          modelLabel="Claude Opus 5.5"
          effort="medium"
          onSelectModel={onSelectModel}
          onSelectEffort={onSelectEffort}
        />
        <PermissionPopover
          sessionId="ses_live_1"
          value="default"
          onChange={onPermChange}
        />
      </div>,
    );

    fireEvent.click(screen.getByLabelText("High"));
    fireEvent.click(screen.getByTestId("open-model-list-btn"));
    fireEvent.click(
      screen.getByRole("option", { name: /Claude Sonnet 4\.5/i }),
    );
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });

    const harnessFrames = posted
      .filter(
        (m): m is { type: string; frame: Record<string, unknown> } =>
          Boolean(
            m &&
              typeof m === "object" &&
              (m as { type?: string }).type === "rayucode.harness.request",
          ),
      )
      .map((m) => m.frame);

    expect(harnessFrames).toContainEqual(
      expect.objectContaining({
        req: "set_reasoning_effort",
        effort: "high",
      }),
    );
    expect(harnessFrames).toContainEqual(
      expect.objectContaining({
        req: "set_model",
        model: "claude-sonnet-4-5",
      }),
    );
    // Zero legacy type:/op: frames and zero duplicate set_permission_mode harness frames
    expect(harnessFrames.some((f) => "type" in f || "op" in f)).toBe(false);
    expect(
      harnessFrames.some((f) => f.req === "set_permission_mode"),
    ).toBe(false);

    delete window.acquireVsCodeApi;
  });

  it("discovers arbitrary future models from live settings.models.get and settings.models.refresh routes", async () => {
    const discoveredRoutes = [
      {
        id: "claude-future-99-sonnet",
        model: "claude-future-99-sonnet",
        provider: "rayu-cloud",
        label: "Claude Future 99 Sonnet",
        available: true,
        detail: "Dynamically discovered route",
      },
    ];
    const refreshedRoutes = [
      ...discoveredRoutes,
      {
        id: "gpt-99-turbo-preview",
        model: "gpt-99-turbo-preview",
        provider: "openai",
        label: "GPT-99 Turbo Preview",
        available: true,
        detail: "Refreshed live catalog route",
      },
    ];

    window.acquireVsCodeApi = () => ({
      postMessage: (msg: unknown) => {
        const rpc = msg as { type?: string; id?: number; method?: string };
        if (rpc.type !== "rayucode.rpc.call" || typeof rpc.id !== "number") {
          return;
        }
        queueMicrotask(() => {
          if (rpc.method === "settings.models.get") {
            __dispatchHostMessageForTest({
              type: "rayucode.rpc.result",
              id: rpc.id!,
              ok: true,
              data: {
                defaultModel: "claude-future-99-sonnet",
                defaultEffort: "medium",
                serviceTier: "auto",
                cacheTtl: "5m",
                transport: "auto",
                roleOverrides: [],
                routes: discoveredRoutes,
              },
            });
          } else if (rpc.method === "settings.models.refresh") {
            __dispatchHostMessageForTest({
              type: "rayucode.rpc.result",
              id: rpc.id!,
              ok: true,
              data: {
                ok: true,
                routeCount: refreshedRoutes.length,
                routes: refreshedRoutes,
              },
            });
          } else if (rpc.method === "settings.providers.list") {
            __dispatchHostMessageForTest({
              type: "rayucode.rpc.result",
              id: rpc.id!,
              ok: true,
              data: { providers: [] },
            });
          } else if (rpc.method === "workspace.listFolders") {
            __dispatchHostMessageForTest({
              type: "rayucode.rpc.result",
              id: rpc.id!,
              ok: true,
              data: { folders: [] },
            });
          } else if (rpc.method === "workspace.listBranches") {
            __dispatchHostMessageForTest({
              type: "rayucode.rpc.result",
              id: rpc.id!,
              ok: true,
              data: { current: "main", branches: ["main"] },
            });
          } else if (rpc.method === "settings.features.get") {
            __dispatchHostMessageForTest({
              type: "rayucode.rpc.result",
              id: rpc.id!,
              ok: true,
              data: {
                features: {},
                voice: {
                  supported: false,
                  enabled: false,
                  devices: [],
                  noiseSuppression: true,
                  autoSendOnSilence: false,
                },
                telemetry: {},
              },
            });
          }
        });
      },
      getState: () => undefined,
      setState: () => undefined,
    });

    try {
      renderWithQuery(<SessionComposer mode="workspace" sessionId="ses_live_1" />);

      // Composer syncs visible model label from live settings.models.get instead of staying on fallback
      await waitFor(() => {
        expect(
          screen.getByTestId("model-effort-trigger").textContent,
        ).toContain("Claude Future 99 Sonnet");
      });

      // Desktop-aligned [+] trigger exists and opens the Add menu
      fireEvent.click(screen.getByTestId("composer-plus-trigger"));
      expect(screen.getByTestId("composer-add-file-mention")).toBeTruthy();
      expect(screen.getByTestId("composer-add-slash")).toBeTruthy();

      fireEvent.click(screen.getByTestId("model-effort-trigger"));
      fireEvent.click(screen.getByTestId("open-model-list-btn"));

      await waitFor(() => {
        expect(
          screen.getByRole("option", { name: /Claude Future 99 Sonnet/i }),
        ).toBeTruthy();
      });

      fireEvent.click(screen.getByTestId("model-refresh-btn"));
      await waitFor(() => {
        expect(
          screen.getByRole("option", { name: /GPT-99 Turbo Preview/i }),
        ).toBeTruthy();
      });
    } finally {
      delete window.acquireVsCodeApi;
    }
  });
});
