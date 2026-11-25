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
]

describe("usePersistedInferenceSettings engine sync", () => {
  beforeEach(() => {
    window.localStorage.clear()
    useAppStore.setState({ activeSessionId: "session_live_1" })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useAppStore.setState({ activeSessionId: null })
  })

  it("syncs setModel and setEffort to the active live daemon session", () => {
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

    act(() => {
      result.current.setModel(sonnet)
      result.current.setEffort("high")
    })

    expect(setModelSpy).toHaveBeenCalledWith("session_live_1", sonnet.id)
    expect(setEffortSpy).toHaveBeenCalledWith("session_live_1", "high")
  })

  it("prefixes Rayu hosted models with rayu: when syncing to an active daemon session", () => {
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

    act(() => {
      result.current.setModel({
        id: "qwen4-max-preview",
        label: "qwen4-max-preview",
        provider: "rayu",
        apiMethod: "rayu",
      })
    })

    expect(setModelSpy).toHaveBeenCalledWith(
      "session_live_1",
      "rayu:qwen4-max-preview"
    )
  })
})
