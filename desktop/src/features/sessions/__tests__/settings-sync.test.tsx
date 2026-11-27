import "@testing-library/jest-dom/vitest"
import * as React from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useAppStore } from "@/lib/app-store"
import { ipcClient } from "@/lib/ipc-client"
import { createQueryClient } from "@/lib/query-client"

import { usePersistedInferenceSettings, type ModelOption } from "../index"

const TEST_CATALOG: readonly ModelOption[] = [
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    supportedEfforts: ["low", "medium", "high", "max"],
    defaultEffort: "medium",
  },
  {
    id: "rayu:claude-opus-4-7",
    label: "Claude Opus 4.7",
    provider: "rayu",
    apiMethod: "rayu",
    supportedEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    defaultEffort: "low",
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    supportedEfforts: [],
  },
]

describe("usePersistedInferenceSettings engine sync", () => {
  beforeEach(() => {
    window.localStorage.clear()
    useAppStore.setState({
      activeSessionId: "session_live_1",
      sessionModelInfoBySession: {},
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    delete (window as unknown as { rayu?: unknown }).rayu
    useAppStore.setState({
      activeSessionId: null,
      sessionModelInfoBySession: {},
    })
  })

  it("syncs setModel and setEffort to the active live daemon session", async () => {
    const setModelSpy = vi
      .spyOn(ipcClient.harness, "setModel")
      .mockResolvedValue({ ok: true })
    const setEffortSpy = vi
      .spyOn(ipcClient.harness, "setReasoningEffort")
      .mockResolvedValue({ ok: true })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={createQueryClient()}>
        {children}
      </QueryClientProvider>
    )

    const { result } = renderHook(
      () => usePersistedInferenceSettings(TEST_CATALOG),
      { wrapper }
    )

    const sonnet = TEST_CATALOG[0]

    await act(async () => {
      result.current.setModel(sonnet)
      result.current.setEffort("high")
      await Promise.resolve()
    })

    expect(setModelSpy).toHaveBeenCalledWith("session_live_1", sonnet.id)
    expect(setEffortSpy).toHaveBeenCalledWith("session_live_1", "high")
  })

  it("prefixes Rayu hosted models with rayu: when syncing to an active daemon session", async () => {
    const setModelSpy = vi
      .spyOn(ipcClient.harness, "setModel")
      .mockResolvedValue({ ok: true })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={createQueryClient()}>
        {children}
      </QueryClientProvider>
    )

    const { result } = renderHook(
      () => usePersistedInferenceSettings(TEST_CATALOG),
      { wrapper }
    )

    await act(async () => {
      result.current.setModel({
        id: "qwen4-max-preview",
        label: "qwen4-max-preview",
        provider: "rayu",
        apiMethod: "rayu",
      })
      await Promise.resolve()
    })

    expect(setModelSpy).toHaveBeenCalledWith(
      "session_live_1",
      "rayu:qwen4-max-preview"
    )
  })

  it("hydrates model & reasoning effort from sessionModelInfoBySession with rayu: matching and clears stale effort when model_info omits reasoning_effort", () => {
    let emittedListener: ((frame: Record<string, unknown>) => void) | null = null
    vi.spyOn(ipcClient.harness, "onEvent").mockImplementation((cb) => {
      emittedListener = cb
      return () => {
        emittedListener = null
      }
    })

    useAppStore.setState({
      activeSessionId: "session_live_1",
      sessionModelInfoBySession: {
        session_live_1: {
          provider: "rayu",
          model: "claude-opus-4-7",
          reasoningEffort: "xhigh",
        },
        session_live_2: {
          provider: "anthropic",
          model: "claude-haiku-4-5",
          reasoningEffort: undefined,
        },
      },
    })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={createQueryClient()}>
        {children}
      </QueryClientProvider>
    )

    const { result } = renderHook(
      () => usePersistedInferenceSettings(TEST_CATALOG),
      { wrapper }
    )

    expect(result.current.modelId).toBe("rayu:claude-opus-4-7")
    expect(result.current.effort).toBe("xhigh")
    expect(result.current.effortLadder.supported).toBe(true)

    // Switch to session with unsupported model (omitted reasoning_effort)
    act(() => {
      useAppStore.setState({ activeSessionId: "session_live_2" })
    })
    expect(result.current.modelId).toBe("claude-haiku-4-5")
    expect(result.current.effort).toBe("")
    expect(result.current.effortLadder.supported).toBe(false)

    // Switch back to session_live_1 and emit model_info with omitted reasoning_effort
    act(() => {
      useAppStore.setState({ activeSessionId: "session_live_1" })
    })
    expect(result.current.effort).toBe("xhigh")

    act(() => {
      emittedListener?.({
        ev: "model_info",
        session_id: "session_live_1",
        provider: "rayu",
        model: "claude-opus-4-7",
      })
    })
    // Cleared effort falls back to engine default ("low"), not stale "xhigh"
    expect(result.current.effort).toBe("low")
  })

  it("probes existing live daemon session via listSessions + getRuntimeInfo on Home boot and hydrates sessionModelInfo", async () => {
    useAppStore.setState({
      activeSessionId: null,
      sessionModelInfoBySession: {},
    })

    const listSessions = vi.fn().mockResolvedValue([
      {
        session_id: "daemon_sess_9",
        working_dir: "/tmp/repo",
        status: "idle",
      },
    ])
    const getRuntimeInfo = vi.fn().mockResolvedValue({
      provider: "anthropic",
      model: "claude-opus-4-7",
      reasoningEffort: "high",
      routes: [
        {
          provider: "anthropic",
          model: "claude-opus-4-7",
          label: "Claude Opus 4.7",
          available: true,
          supported_efforts: ["none", "low", "medium", "high", "xhigh", "max"],
          default_effort: "low",
        },
        {
          provider: "anthropic",
          model: "claude-haiku-4-5",
          label: "Claude Haiku 4.5",
          available: true,
          supported_efforts: [],
        },
      ],
    })

    ;(window as unknown as { rayu?: unknown }).rayu = {
      daemon: {
        getStatus: vi.fn().mockResolvedValue({
          connected: true,
          mode: "live",
          reconnecting: false,
          socketPath: "/tmp/rayu.sock",
          version: "1.0.0",
          latencyMs: 1,
        }),
      },
      harness: {
        listSessions,
        getRuntimeInfo,
      },
    }

    const models = await ipcClient.models.list()

    expect(listSessions).toHaveBeenCalledWith({ includeExternal: false })
    expect(getRuntimeInfo).toHaveBeenCalledWith("daemon_sess_9")
    expect(models).toHaveLength(2)
    expect(models[0]).toMatchObject({
      id: "claude-opus-4-7",
      supportedEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
      defaultEffort: "low",
    })
    expect(models[1]).toMatchObject({
      id: "claude-haiku-4-5",
      supportedEfforts: [],
    })
    expect(
      useAppStore.getState().sessionModelInfoBySession["daemon_sess_9"]
    ).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-7",
      reasoningEffort: "high",
    })
  })

  it("populates engine-accurate effort ladders on Rayu Cloud fallback catalog and forwards reasoningEffort on sendPrompt", async () => {
    useAppStore.setState({
      activeSessionId: null,
      sessionModelInfoBySession: {},
    })

    const streamChat = vi.fn().mockResolvedValue({ ok: true })
    ;(window as unknown as { rayu?: unknown }).rayu = {
      auth: {
        getState: vi.fn().mockResolvedValue({
          signedIn: true,
          method: "oauth",
          signingIn: false,
          pendingAuthUrl: null,
          user: { id: "u1", email: "dev@rayu.ai" },
          credits: null,
          allowedModels: [
            {
              code: "claude-opus-4-7",
              label: "Claude Opus 4.7",
              supportsReasoning: true,
              supportedEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
              defaultEffort: "medium",
            },
            {
              code: "gpt-5.4",
              label: "GPT-5.4",
              supportsReasoning: true,
            },
            {
              code: "claude-haiku-4-5",
              label: "Claude Haiku 4.5",
              supportsReasoning: false,
            },
            {
              code: "gemini-3-flash",
              label: "Gemini 3 Flash",
              supportedEfforts: [],
            },
          ],
          apiBase: "https://api.rayucode.com/api",
          webBase: "https://rayucode.com",
          gatewayBase: "https://gateway.rayucode.com",
          error: null,
        }),
      },
      cloud: {
        streamChat,
      },
    }

    await ipcClient.auth.getState()
    const models = await ipcClient.models.list()

    expect(models.find((m) => m.id === "default")).toMatchObject({
      supportedEfforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
      defaultEffort: "low",
    })
    expect(models.find((m) => m.id === "claude-opus-4-7")).toMatchObject({
      supportedEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
      defaultEffort: "medium",
    })
    expect(models.find((m) => m.id === "gpt-5.4")).toMatchObject({
      supportedEfforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
      defaultEffort: "low",
    })
    expect(models.find((m) => m.id === "claude-haiku-4-5")?.supportedEfforts).toEqual([])
    const gemini = models.find((m) => m.id === "gemini-3-flash")
    expect(gemini?.supportedEfforts).toEqual([])
    expect(gemini?.defaultEffort).toBeUndefined()
    expect(
      models.every(
        (m) => !(m.supportedEfforts ?? []).includes("auto")
      )
    ).toBe(true)

    // Verify staged effort is forwarded on cloud sendPrompt
    ipcClient.harness.stagePromptEffort("ses_cloud_1", "xhigh")
    await ipcClient.trace.sendPrompt({
      sessionId: "ses_cloud_1",
      prompt: "Audit reasoning effort",
      modelId: "claude-opus-4-7",
      modelLabel: "Claude Opus 4.7",
    })
    expect(streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "ses_cloud_1",
        model: "claude-opus-4-7",
        reasoningEffort: "xhigh",
      })
    )
  })
})
