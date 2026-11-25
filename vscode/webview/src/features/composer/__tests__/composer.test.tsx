import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as rpcClient from "@/lib/rpc-client";
import {
  __dispatchHostMessageForTest,
  createQueryClient,
  setMediaBaseUri,
  useAppStore,
} from "@/lib";

import {
  ActiveSelectionPill,
  EFFORT_STOPS,
  formatHarnessModelSpec,
  HomePage,
  mergeComposerInjection,
  ModelEffortPopover,
  normalizeProviderIdForLookup,
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
    vi.restoreAllMocks();
    setMediaBaseUri("vscode-webview-resource://rayu-ext/media");
    useAppStore.setState({
      surface: "editorPanel",
      route: "home",
      activeRoute: "home",
      activeSessionId: null,
      activeSessionTitle: null,
      editorSelection: null,
      pendingComposerInjection: null,
      composerDrafts: {},
      midTurnSendMode: "steer",
      midTurnMessagesBySession: {},
      pausedQueueSessions: {},
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

    fireEvent.click(screen.getByLabelText("xHigh"));
    expect(onSelectEffort).toHaveBeenLastCalledWith("xhigh");
    expect(screen.getByTestId("effort-level-value").textContent).toBe("xHigh");

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
        model: "rayu:claude-sonnet-4-5",
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

  it("merges multi-file @mentions, deduplicates at token boundaries, and supports append vs replace in mergeComposerInjection", () => {
    // Multi-file normalization + intra-payload deduplication
    expect(
      mergeComposerInjection("", {
        id: "inj_1",
        mentions: ["src/a.ts", "@src/b.ts", "src/a.ts"],
      }),
    ).toBe("@src/a.ts @src/b.ts ");

    // Token-boundary safety: @src/a.ts must NOT collide with @src/a.tsx in either direction
    expect(
      mergeComposerInjection("@src/a.ts ", {
        id: "inj_2",
        mentions: ["src/a.ts", "src/a.tsx", "src/b.ts"],
      }),
    ).toBe("@src/a.ts @src/a.tsx @src/b.ts ");

    expect(
      mergeComposerInjection("@src/a.tsx ", {
        id: "inj_3",
        mentions: ["src/a.ts"],
      }),
    ).toBe("@src/a.tsx @src/a.ts ");

    // Append prompt onto empty vs non-empty text
    expect(
      mergeComposerInjection("", {
        id: "inj_4",
        prompt: "  Explain this selection  ",
      }),
    ).toBe("Explain this selection");

    expect(
      mergeComposerInjection("Keep error handling intact.", {
        id: "inj_5",
        prompt: "Explain this selection",
      }),
    ).toBe("Keep error handling intact.\n\nExplain this selection");

    // Replace mode replaces existing text cleanly, keeping mentions + prompt
    expect(
      mergeComposerInjection("Stale draft text", {
        id: "inj_6",
        mode: "replace",
        mentions: ["src/a.ts"],
        prompt: "Fix the type error",
      }),
    ).toBe("@src/a.ts\n\nFix the type error");

    expect(
      mergeComposerInjection("Stale draft text", {
        id: "inj_7",
        mode: "replace",
        prompt: "Fix the type error",
      }),
    ).toBe("Fix the type error");
  });

  it("re-attaches excluded ActiveSelectionPill on explicit injection and auto-submits fresh injected text without stale closures", async () => {
    const initialSelection = {
      filePath: "/workspace/rayucode-v2/src/a.ts",
      relativePath: "src/a.ts",
      languageId: "typescript",
      lineStart: 4,
      lineEnd: 12,
      lineCount: 9,
      selectedText: "export const a = 1;",
    };
    const nextSelection = {
      filePath: "/workspace/rayucode-v2/src/b.ts",
      relativePath: "src/b.ts",
      languageId: "typescript",
      lineStart: 20,
      lineEnd: 30,
      lineCount: 11,
      selectedText: "export function fixMe() {}",
    };

    useAppStore.getState().setEditorSelection(initialSelection);
    const onSubmit = vi.fn();

    renderWithQuery(
      <SessionComposer mode="workspace" sessionId="ses_1" onSubmit={onSubmit} />,
    );

    // User explicitly excludes the initial selection pill
    expect(
      screen.getByTestId("active-selection-pill").getAttribute("data-included"),
    ).toBe("true");
    fireEvent.click(screen.getByTestId("active-selection-toggle"));
    expect(
      screen.getByTestId("active-selection-pill").getAttribute("data-included"),
    ).toBe("false");

    // Inject fresh explicit selection with autoSubmit: false -> re-attaches pill & prefills text
    useAppStore.getState().applyHostMessage({
      type: "rayucode.composer.inject",
      injection: {
        id: "inj_reattach_1",
        mentions: ["src/b.ts"],
        prompt: "Explain this helper",
        selection: nextSelection,
        autoSubmit: false,
      },
    });

    await waitFor(() => {
      const textarea = screen.getByTestId(
        "composer-textarea",
      ) as HTMLTextAreaElement;
      expect(textarea.value).toBe("@src/b.ts\n\nExplain this helper");
    });
    expect(
      screen.getByTestId("active-selection-pill").getAttribute("data-included"),
    ).toBe("true");
    expect(useAppStore.getState().pendingComposerInjection).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();

    // Exclude again, then inject with autoSubmit: true -> submits exact freshly injected text + selection!
    fireEvent.click(screen.getByTestId("active-selection-toggle"));
    expect(
      screen.getByTestId("active-selection-pill").getAttribute("data-included"),
    ).toBe("false");

    useAppStore.getState().applyHostMessage({
      type: "rayucode.composer.inject",
      injection: {
        id: "inj_autosubmit_2",
        mode: "replace",
        prompt: "Fix TS2322 in @src/b.ts#L20-L30",
        selection: nextSelection,
        workingDir: "/workspace/rayu-cloud-api",
        autoSubmit: true,
      },
    });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Fix TS2322 in @src/b.ts#L20-L30",
        workingDir: "/workspace/rayu-cloud-api",
        editorSelection: expect.objectContaining({ relativePath: "src/b.ts" }),
        selectionIncluded: true,
      }),
    );
    expect(useAppStore.getState().pendingComposerInjection).toBeNull();
  });

  it("consumes pendingComposerInjection inside controlled HomePage and preserves updated workingDir", async () => {
    renderWithQuery(<HomePage userName="Rayu" />);

    useAppStore.getState().applyHostMessage({
      type: "rayucode.composer.inject",
      injection: {
        id: "inj_home_1",
        mentions: ["src/app.ts", "src/utils.ts"],
        prompt: "Audit these two files",
        workingDir: "/workspace/rayu-cloud-api",
        autoSubmit: false,
      },
    });

    await waitFor(() => {
      const textarea = screen.getByTestId(
        "composer-textarea",
      ) as HTMLTextAreaElement;
      expect(textarea.value).toBe(
        "@src/app.ts @src/utils.ts\n\nAudit these two files",
      );
    });
    expect(useAppStore.getState().activeProjectPath).toBe(
      "/workspace/rayu-cloud-api",
    );
    expect(useAppStore.getState().pendingComposerInjection).toBeNull();
    expect(
      screen.getByTestId("composer-workspace-picker").textContent,
    ).toContain("rayu-cloud-api");
  });

  it("preserves injected composer draft across unmount/remount (e.g. AppShell form-factor resize across 560px/960px)", async () => {
    useAppStore.setState({
      activeSessionId: "ses_resize_test",
      route: "workspace",
      activeRoute: "workspace",
    });

    const first = renderWithQuery(
      <SessionComposer mode="workspace" sessionId="ses_resize_test" />,
    );

    useAppStore.getState().applyHostMessage({
      type: "rayucode.composer.inject",
      injection: {
        id: "inj_resize_1",
        mentions: ["src/auth.ts"],
        prompt: "Fix TS2345 on line 42.",
        mode: "replace",
        autoSubmit: false,
      },
    });

    await waitFor(() => {
      const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
      expect(ta.value).toBe("@src/auth.ts\n\nFix TS2345 on line 42.");
    });

    // Simulate AppShell unmounting Wide tree and remounting Compact tree
    first.unmount();

    renderWithQuery(
      <SessionComposer mode="workspace" sessionId="ses_resize_test" />,
    );
    const remountedTa = screen.getByTestId(
      "composer-textarea",
    ) as HTMLTextAreaElement;
    expect(remountedTa.value).toBe("@src/auth.ts\n\nFix TS2345 on line 42.");
  });

  it("normalizes provider aliases and formats canonical rayu: model specs", () => {
    expect(normalizeProviderIdForLookup("Rayu Cloud Gateway")).toBe("rayu");
    expect(normalizeProviderIdForLookup("rayu-cloud")).toBe("rayu");
    expect(normalizeProviderIdForLookup("subscription")).toBe("rayu");
    expect(normalizeProviderIdForLookup("claude-api")).toBe("anthropic");
    expect(normalizeProviderIdForLookup("Google")).toBe("gemini");
    expect(normalizeProviderIdForLookup("github-copilot")).toBe("copilot");

    expect(formatHarnessModelSpec("", "rayu", "rayu")).toBe("");
    expect(formatHarnessModelSpec("default", "rayu", "rayu")).toBe("");
    expect(
      formatHarnessModelSpec("claude-sonnet-4-5", "rayu-cloud", undefined),
    ).toBe("rayu:claude-sonnet-4-5");
    expect(
      formatHarnessModelSpec("qwen4-max-preview", "Rayu Cloud", "rayu"),
    ).toBe("rayu:qwen4-max-preview");
    expect(
      formatHarnessModelSpec("rayu:qwen4-max-preview", "rayu", "rayu"),
    ).toBe("rayu:qwen4-max-preview");
    expect(
      formatHarnessModelSpec("claude-sonnet-4-5", "anthropic", "claude-oauth"),
    ).toBe("claude-sonnet-4-5");
  });

  it("auto-syncs SessionComposer from initial fallback to live authenticated rayu: model from settings.models.get and submits rayu:<model>", async () => {
    useAppStore.setState({
      accountStatus: {
        signedIn: true,
        authMethod: "oauth",
        displayName: "Rayu Developer",
        email: "dev@rayucode.com",
        windows: [],
      },
    });

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
                defaultModel: "claude-sonnet-4-5",
                defaultEffort: "medium",
                serviceTier: "auto",
                cacheTtl: "5m",
                transport: "auto",
                roleOverrides: [],
                routes: [
                  {
                    id: "claude-sonnet-4-5",
                    model: "claude-sonnet-4-5",
                    provider: "anthropic",
                    label: "Claude Sonnet 4.5",
                    available: false,
                  },
                  {
                    id: "claude-sonnet-4-5",
                    model: "claude-sonnet-4-5",
                    modelSpec: "rayu:claude-sonnet-4-5",
                    provider: "rayu",
                    apiMethod: "rayu",
                    label: "Claude Sonnet 4.5",
                    available: true,
                    detail: "Rayu Cloud Gateway",
                  },
                ],
              },
            });
          } else if (rpc.method === "settings.providers.list") {
            __dispatchHostMessageForTest({
              type: "rayucode.rpc.result",
              id: rpc.id!,
              ok: true,
              data: {
                providers: [
                  {
                    id: "rayu",
                    name: "Rayu Cloud Gateway",
                    category: "native",
                    status: "ready",
                    authMethod: "oauth",
                    accountLabel: "dev@rayucode.com",
                  },
                  {
                    id: "anthropic",
                    name: "Anthropic",
                    category: "native",
                    status: "needs_key",
                    authMethod: "none",
                  },
                ],
              },
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

    const onSubmit = vi.fn();
    try {
      renderWithQuery(
        <SessionComposer
          mode="workspace"
          sessionId="ses_auth_sync"
          onSubmit={onSubmit}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("model-effort-trigger").textContent).toContain(
          "Claude Sonnet 4.5",
        );
      });

      const textarea = screen.getByTestId("composer-textarea");
      fireEvent.change(textarea, {
        target: { value: "Verify authenticated Rayu model spec on submit" },
      });
      fireEvent.click(screen.getByTestId("composer-submit-btn"));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: "rayu:claude-sonnet-4-5",
          modelSpec: "rayu:claude-sonnet-4-5",
          modelLabel: "Claude Sonnet 4.5",
          apiMethod: "rayu",
        }),
      );
    } finally {
      delete window.acquireVsCodeApi;
    }
  });

  it("distinguishes rayu (ready) vs anthropic (needs key) for the same bare model name with zero duplicate-key warnings and sends rayu:<model> on set_model", () => {
    const posted: unknown[] = [];
    window.acquireVsCodeApi = () => ({
      postMessage: (msg: unknown) => posted.push(msg),
      getState: () => undefined,
      setState: () => undefined,
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      const onSelectModel = vi.fn();
      const onSelectEffort = vi.fn();
      const models = [
        {
          id: "claude-sonnet-4-5",
          modelSpec: "rayu:claude-sonnet-4-5",
          label: "Claude Sonnet 4.5",
          provider: "rayu",
          apiMethod: "rayu",
          authMethod: "oauth" as const,
          accountLabel: "dev@rayucode.com",
          available: true,
          subtitle: "Rayu Cloud Gateway",
        },
        {
          id: "claude-sonnet-4-5",
          modelSpec: "claude-sonnet-4-5",
          label: "Claude Sonnet 4.5",
          provider: "anthropic",
          available: false,
          unavailableReason: "Requires Anthropic API key",
        },
      ];

      renderWithQuery(
        <ModelEffortPopover
          defaultOpen
          initialStage="list"
          sessionId="ses_same_bare_id"
          modelId="rayu:claude-sonnet-4-5"
          modelLabel="Claude Sonnet 4.5"
          effort="medium"
          models={models}
          onSelectModel={onSelectModel}
          onSelectEffort={onSelectEffort}
        />,
      );

      expect(screen.getByTestId("model-group-authenticated")).toBeTruthy();
      expect(screen.getByTestId("model-group-unavailable")).toBeTruthy();

      const options = screen.getAllByRole("option") as HTMLButtonElement[];
      expect(options).toHaveLength(2);
      const rayuOption = options.find(
        (el) => el.getAttribute("data-provider") === "rayu",
      );
      const anthropicOption = options.find(
        (el) => el.getAttribute("data-provider") === "anthropic",
      );

      expect(rayuOption).toBeTruthy();
      expect(rayuOption?.disabled).toBe(false);
      expect(rayuOption?.getAttribute("aria-selected")).toBe("true");
      expect(rayuOption?.textContent).toContain("Rayu Cloud");

      expect(anthropicOption).toBeTruthy();
      expect(anthropicOption?.disabled).toBe(true);
      expect(anthropicOption?.getAttribute("aria-selected")).toBe("false");
      expect(anthropicOption?.textContent).toContain("Anthropic");
      expect(anthropicOption?.textContent).toContain(
        "Requires Anthropic API key",
      );

      // Zero React duplicate-key warnings
      const keyWarnings = consoleErrorSpy.mock.calls.filter((call) =>
        call.some(
          (arg) =>
            typeof arg === "string" &&
            arg.toLowerCase().includes("same key"),
        ),
      );
      expect(keyWarnings).toHaveLength(0);

      fireEvent.click(rayuOption!);
      expect(onSelectModel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "claude-sonnet-4-5",
          modelSpec: "rayu:claude-sonnet-4-5",
          provider: "rayu",
        }),
      );

      const setModelFrames = posted
        .filter(
          (m): m is { type: string; frame: Record<string, unknown> } =>
            Boolean(
              m &&
                typeof m === "object" &&
                (m as { type?: string }).type === "rayucode.harness.request",
            ),
        )
        .map((m) => m.frame)
        .filter((f) => f.req === "set_model");

      expect(setModelFrames).toContainEqual(
        expect.objectContaining({
          req: "set_model",
          session_id: "ses_same_bare_id",
          model: "rayu:claude-sonnet-4-5",
        }),
      );
    } finally {
      consoleErrorSpy.mockRestore();
      delete window.acquireVsCodeApi;
    }
  });

  it("renders crisp empty state with Refresh models button when ModelEffortPopover receives an empty catalog", () => {
    const onRefreshModels = vi.fn();
    renderWithQuery(
      <ModelEffortPopover
        defaultOpen
        initialStage="list"
        modelId="rayu:claude-sonnet-4-5"
        modelLabel="Claude Sonnet 4.5"
        effort="medium"
        models={[]}
        onSelectModel={vi.fn()}
        onSelectEffort={vi.fn()}
        onRefreshModels={onRefreshModels}
      />,
    );

    expect(screen.getByTestId("model-list-empty")).toBeTruthy();
    fireEvent.click(screen.getByTestId("model-empty-refresh-btn"));
    expect(onRefreshModels).toHaveBeenCalledTimes(1);
  });

  it("supports mid-turn Steer (default, urgent: false, caller clientId) vs Queue toggle, keeps Stop button visible, and toggles alternate mode on Alt+Enter", async () => {
    const rpcSpy = vi.spyOn(rpcClient, "callRpc");
    const onStop = vi.fn();
    const onSubmit = vi.fn();

    useAppStore.setState({
      activeSessionId: "ses_midturn_1",
      isStreamActive: true,
      midTurnSendMode: "steer",
      midTurnMessagesBySession: {},
    });

    renderWithQuery(
      <SessionComposer
        mode="workspace"
        sessionId="ses_midturn_1"
        isSubmitting={true}
        onStop={onStop}
        onSubmit={onSubmit}
      />,
    );

    // Mid-turn bar & Stop button visible while streaming
    expect(screen.getByTestId("composer-midturn-bar")).toBeTruthy();
    expect(
      screen.getByTestId("midturn-mode-steer").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByTestId("midturn-mode-queue").getAttribute("aria-pressed"),
    ).toBe("false");
    expect(screen.getByTestId("composer-stop-btn")).toBeTruthy();
    expect(screen.getByTestId("composer-steer-btn")).toBeTruthy();

    const textarea = screen.getByTestId(
      "composer-textarea",
    ) as HTMLTextAreaElement;

    // 1. Type text: Stop button MUST stay visible right beside Steer button
    fireEvent.change(textarea, {
      target: { value: "Keep unit tests deterministic" },
    });
    expect(screen.getByTestId("composer-stop-btn")).toBeTruthy();
    expect(screen.getByTestId("composer-steer-btn")).toBeTruthy();

    // Click Steer -> sends sessions.softInterrupt with urgent: false and caller clientId, never cancels
    fireEvent.click(screen.getByTestId("composer-steer-btn"));

    await waitFor(() => {
      const items =
        useAppStore.getState().midTurnMessagesBySession["ses_midturn_1"] ?? [];
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual(
        expect.objectContaining({
          sessionId: "ses_midturn_1",
          mode: "steer",
          text: "Keep unit tests deterministic",
        }),
      );
      expect(rpcSpy).toHaveBeenCalledWith("sessions.softInterrupt", {
        sessionId: "ses_midturn_1",
        text: "Keep unit tests deterministic",
        urgent: false,
        clientId: items[0].id,
      });
    });
    expect(onStop).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("");

    // 2. Toggle to Queue mode -> queues without calling sessions.softInterrupt
    rpcSpy.mockClear();
    fireEvent.click(screen.getByTestId("midturn-mode-queue"));
    expect(
      screen.getByTestId("midturn-mode-queue").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByTestId("composer-queue-btn")).toBeTruthy();
    expect(screen.getByTestId("composer-stop-btn")).toBeTruthy();

    fireEvent.change(textarea, {
      target: { value: "Run pnpm verify afterwards" },
    });
    fireEvent.click(screen.getByTestId("composer-queue-btn"));

    const afterQueue =
      useAppStore.getState().midTurnMessagesBySession["ses_midturn_1"] ?? [];
    expect(afterQueue).toHaveLength(2);
    expect(afterQueue[1]).toEqual(
      expect.objectContaining({
        sessionId: "ses_midturn_1",
        mode: "queue",
        text: "Run pnpm verify afterwards",
      }),
    );
    expect(rpcSpy).not.toHaveBeenCalledWith(
      "sessions.softInterrupt",
      expect.anything(),
    );

    // 3. Alt+Enter while in Queue mode sends alternate mode (Steer)
    fireEvent.change(textarea, {
      target: { value: "Also check light theme contrast" },
    });
    fireEvent.keyDown(textarea, { key: "Enter", altKey: true });

    await waitFor(() => {
      const items =
        useAppStore.getState().midTurnMessagesBySession["ses_midturn_1"] ?? [];
      expect(items).toHaveLength(3);
      expect(items[2]).toEqual(
        expect.objectContaining({
          mode: "steer",
          text: "Also check light theme contrast",
        }),
      );
      expect(rpcSpy).toHaveBeenCalledWith("sessions.softInterrupt", {
        sessionId: "ses_midturn_1",
        text: "Also check light theme contrast",
        urgent: false,
        clientId: items[2].id,
      });
    });

    // 4. Switch back to Steer mode and press Alt+Enter -> sends alternate mode (Queue)
    rpcSpy.mockClear();
    fireEvent.click(screen.getByTestId("midturn-mode-steer"));
    fireEvent.change(textarea, {
      target: { value: "Summarize changed files at the end" },
    });
    fireEvent.keyDown(textarea, { key: "Enter", altKey: true });

    const finalItems =
      useAppStore.getState().midTurnMessagesBySession["ses_midturn_1"] ?? [];
    expect(finalItems).toHaveLength(4);
    expect(finalItems[3]).toEqual(
      expect.objectContaining({
        mode: "queue",
        text: "Summarize changed files at the end",
      }),
    );
    expect(rpcSpy).not.toHaveBeenCalledWith(
      "sessions.softInterrupt",
      expect.anything(),
    );
  });
});
