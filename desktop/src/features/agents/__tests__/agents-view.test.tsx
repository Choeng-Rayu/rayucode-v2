import "@testing-library/jest-dom/vitest"
import { QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { useAppStore } from "@/lib/app-store"
import { ipcClient, type AgentsState } from "@/lib/ipc-client"
import { createQueryClient } from "@/lib/query-client"

import { AgentsView } from "../index"

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver =
      ResizeObserverStub as unknown as typeof ResizeObserver
  }
})

function createMockAgentsState(): AgentsState {
  return {
    sessionId: "sess-123",
    subagentModel: null,
    inheritModel: "rayu:claude-sonnet-4-5",
    defaults: {
      swarm: "rayu:claude-sonnet-4-5",
      review: "architect",
      judge: null,
      memory: null,
      ambient: null,
    },
    overrides: {
      swarm: null,
      review: null,
      judge: null,
      memory: null,
      ambient: null,
    },
    effective: {
      swarm: "rayu:claude-sonnet-4-5",
      review: "rayu:claude-opus-4-5",
      judge: null,
      memory: null,
      ambient: null,
    },
    profiles: [
      {
        name: "architect",
        model: "rayu:claude-opus-4-5",
        effort: "high",
        description: "Systems design and deep code review.",
        scope: "global",
      },
    ],
    globalProfiles: [
      {
        name: "architect",
        model: "rayu:claude-opus-4-5",
        effort: "high",
        description: "Systems design and deep code review.",
        scope: "global",
      },
    ],
    sessionProfiles: [],
    swarmAllowlist: ["rayu:claude-sonnet-4-5", "rayu:claude-opus-4-5"],
    models: ["rayu:claude-sonnet-4-5", "rayu:claude-opus-4-5", "openai:gpt-5"],
    routes: [
      {
        id: "rayu:claude-sonnet-4-5",
        label: "Claude Sonnet 4.5",
        provider: "rayu",
        model: "claude-sonnet-4-5",
        modelSpec: "rayu:claude-sonnet-4-5",
        available: true,
      },
      {
        id: "rayu:claude-opus-4-5",
        label: "Claude Opus 4.5",
        provider: "rayu",
        model: "claude-opus-4-5",
        modelSpec: "rayu:claude-opus-4-5",
        available: true,
      },
    ],
    configPath: "~/.rayu/config.toml",
    daemonConnected: true,
    daemonError: null,
  }
}

function renderAgentsView() {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <AgentsView />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

describe("AgentsView", () => {
  let stateRef: AgentsState

  beforeEach(() => {
    stateRef = createMockAgentsState()
    useAppStore.getState().setActiveRoute("agents")
    useAppStore.getState().setActiveSession("sess-123")

    vi.spyOn(ipcClient.agents, "getState").mockImplementation(async () =>
      structuredClone(stateRef)
    )
    vi.spyOn(ipcClient.agents, "upsertProfile").mockImplementation(
      async (input) => {
        const nextProfile = {
          name: input.name.toLowerCase(),
          model: input.model,
          effort: input.effort ?? null,
          description: input.description ?? "",
          scope: input.scope,
        }
        stateRef = {
          ...stateRef,
          profiles: [
            ...stateRef.profiles.filter((p) => p.name !== nextProfile.name),
            nextProfile,
          ],
        }
        return structuredClone(stateRef)
      }
    )
    vi.spyOn(ipcClient.agents, "deleteProfile").mockImplementation(
      async (input) => {
        stateRef = {
          ...stateRef,
          profiles: stateRef.profiles.filter((p) => p.name !== input.name),
        }
        return structuredClone(stateRef)
      }
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders role routing, existing personas, and config preview", async () => {
    renderAgentsView()
    await screen.findByTestId("agents-view")

    expect(screen.getByTestId("agents-subagent-model-row")).toBeInTheDocument()
    expect(screen.getByTestId("agents-role-row-swarm")).toBeInTheDocument()
    expect(screen.getByTestId("agents-role-row-review")).toHaveTextContent(
      "Resolves to rayu:claude-opus-4-5"
    )
    expect(
      screen.getByTestId("agents-profile-card-architect")
    ).toBeInTheDocument()
    expect(screen.getByTestId("agents-swarm-allowlist")).toBeInTheDocument()
    expect(screen.getByTestId("agents-config-preview")).toHaveTextContent(
      'name = "architect"'
    )
  })

  it("creates a new persona via quick blueprint and deletes an existing persona", async () => {
    renderAgentsView()
    await screen.findByTestId("agents-view")

    fireEvent.click(screen.getByTestId("agents-preset-coder"))
    await screen.findByTestId("agents-persona-dialog")

    expect(screen.getByTestId("persona-name-input")).toHaveValue("coder")
    fireEvent.click(screen.getByTestId("persona-save-btn"))

    await waitFor(() => {
      expect(ipcClient.agents.upsertProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "coder",
          scope: "global",
          effort: "medium",
        })
      )
    })
    expect(
      await screen.findByTestId("agents-profile-card-coder")
    ).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("agents-delete-profile-architect"))
    await waitFor(() => {
      expect(ipcClient.agents.deleteProfile).toHaveBeenCalledWith(
        expect.objectContaining({ name: "architect", scope: "global" })
      )
    })
    expect(
      screen.queryByTestId("agents-profile-card-architect")
    ).not.toBeInTheDocument()
  })
})
