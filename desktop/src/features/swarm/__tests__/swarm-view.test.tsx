import "@testing-library/jest-dom/vitest"

import { QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useAppStore } from "@/lib/app-store"
import { ipcClient, type SwarmState } from "@/lib/ipc-client"
import { createQueryClient } from "@/lib/query-client"

import { SwarmView } from "../index"

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

function createInitialSwarmFixture(): SwarmState {
  return {
    swarmId: "swm_a41f",
    title: "Gateway retry & session shards",
    planVersion: "plan v3",
    credits: "1.18 cr",
    kvCachePct: 94,
    agents: [
      {
        id: "coordinator",
        name: "coordinator",
        role: "Root · depth 0",
        worktree: "root",
        state: "coordinating",
        task: "Owns VersionedPlan v3 · waiting on worker-1 & worker-2",
        model: "Claude Opus 5.5",
        laneProgressLabel: "3 scopes",
        duration: "2m 14s",
        todoLane: [
          {
            id: "c1",
            text: "Split work into 2 isolated git worktrees (zero file overlap)",
            status: "done",
          },
          {
            id: "c2",
            text: "Received automatic completion report from verifier-1 (14/14 green)",
            status: "done",
          },
          {
            id: "c3",
            text: "Awaiting worker-1 and worker-2 completion before handoff",
            status: "now",
          },
        ],
        commands: [],
        note: "Coordinator holds the single VersionedPlan slot and never performs git merges directly.",
      },
      {
        id: "worker-1",
        name: "worker-1",
        role: "wt/retry-budget",
        worktree: "wt/retry-budget",
        state: "running",
        task: "Fix streaming_midflight_retry_dedup in src/retry/stream.rs",
        model: "Claude Sonnet 5",
        laneProgressLabel: "2 / 3 lane items",
        duration: "48s",
        reportsTo: "coordinator",
        readFiles: ["src/retry/stream.rs:42-118"],
        todoLane: [
          {
            id: "w1_1",
            text: "Reproduce mid-flight retry dedup failure in retry_budget tests",
            status: "done",
          },
          {
            id: "w1_2",
            text: "Guard duplicate attempt key in src/retry/stream.rs",
            status: "done",
          },
          {
            id: "w1_3",
            text: "Re-run cargo test -p rayu-gateway retry_budget and forward output",
            status: "now",
          },
        ],
        commands: [
          {
            id: "sw_sh_w1_1",
            kind: "command",
            command: "cargo test -p rayu-gateway retry_budget",
            displayCommand: "cargo test -p rayu-gateway retry_budget (first run)",
            output: "test streaming_midflight_retry_dedup ... FAILED",
            exitCode: 1,
            statusLabel: "Exit 1 · isolated to stream.rs:78",
            isFailed: true,
            isMono: true,
          },
          {
            id: "sw_sh_w1_2",
            kind: "command",
            command: "cargo test -p rayu-gateway retry_budget -- --nocapture",
            displayCommand:
              "cargo test -p rayu-gateway retry_budget -- --nocapture",
            output: "test result: ok. 6 passed; 0 failed; finished in 0.31s",
            exitCode: 0,
            statusLabel: "Success · auto-forwarding tail to coordinator",
            isMono: true,
          },
        ],
      },
      {
        id: "worker-2",
        name: "worker-2",
        role: "wt/session-shards",
        worktree: "wt/session-shards",
        state: "running",
        task: "Benchmark ShardStore::lookup p99 under 50k active keys",
        model: "GPT-6.1 Sol",
        laneProgressLabel: "1 / 2 lane items",
        duration: "34s",
        reportsTo: "coordinator",
        todoLane: [
          {
            id: "w2_1",
            text: "Add 50k-key lookup benchmark to crates/rayucode-core/benches",
            status: "done",
          },
          {
            id: "w2_2",
            text: "Measure p99 latency delta vs retired SessionCache",
            status: "now",
          },
        ],
        commands: [
          {
            id: "sw_sh_w2_1",
            kind: "command",
            command: "cargo bench -p rayucode-core shard_lookup_50k",
            displayCommand: "cargo bench -p rayucode-core shard_lookup_50k",
            output: "shard_lookup_50k time: [142.4 ns 144.1 ns 146.0 ns]",
            exitCode: 0,
            statusLabel: "Success",
            isMono: true,
          },
        ],
      },
      {
        id: "verifier-1",
        name: "verifier-1",
        role: "read-only",
        worktree: "local checkout",
        state: "completed",
        task: "Verified 14/14 session:: unit tests · auto-reported to root",
        model: "DeepSeek V4 Flash",
        laneProgressLabel: "2 / 2 lane items",
        duration: "19s",
        reportsTo: "coordinator",
        todoLane: [
          {
            id: "v1",
            text: "Verify session:: test suite across workspace",
            status: "done",
          },
          {
            id: "v2",
            text: "Check zero conflicting edits across active worktrees",
            status: "done",
          },
        ],
        commands: [
          {
            id: "sw_sh_v1",
            kind: "command",
            command: "cargo test -p rayucode session::",
            displayCommand: "cargo test -p rayucode session::",
            output: "test result: ok. 14 passed; 0 failed; finished in 0.44s",
            exitCode: 0,
            statusLabel: "Auto-reported to coordinator",
            isMono: true,
          },
        ],
      },
    ],
    messages: [
      {
        id: "msg_1",
        time: "01:49:18",
        from: "worker-1",
        to: "coordinator",
        text: "Fixed mid-flight retry dedup in src/retry/stream.rs:78 — 6/6 retry_budget tests green.",
        tag: "auto-output",
        isOk: true,
      },
      {
        id: "msg_2",
        time: "01:48:52",
        from: "verifier-1",
        to: "coordinator",
        text: "Completed read-only check: 14/14 session:: tests pass, zero cross-worktree conflicts.",
        tag: "completed",
        isOk: true,
      },
      {
        id: "msg_3",
        time: "01:48:10",
        from: "coordinator",
        to: "@all",
        text: "Approved VersionedPlan v3: isolated wt/retry-budget and wt/session-shards scopes.",
        tag: "broadcast",
      },
    ],
    planScopes: [
      {
        id: "sc_1",
        scopeLabel: "Scope 1",
        ownerRoute: "worker-1 · wt/retry-budget",
        description:
          "Deduplicate streaming mid-flight retries in rayu-gateway and verify 6 unit tests.",
        statusTag: "6/6 green",
        isOk: true,
      },
      {
        id: "sc_2",
        scopeLabel: "Scope 2",
        ownerRoute: "worker-2 · wt/session-shards",
        description:
          "Benchmark ShardStore::lookup p99 under 50k keys (-30.2% latency confirmed).",
        statusTag: "running",
        isOk: true,
      },
    ],
    worktrees: [
      {
        id: "wt_1",
        label: "wt-1",
        branch: "wt/retry-budget",
        owner: "worker-1",
        file: "src/retry/stream.rs",
        additions: 28,
        deletions: 9,
      },
      {
        id: "wt_2",
        label: "wt-2",
        branch: "wt/session-shards",
        owner: "worker-2",
        file: "benches/shard_lookup.rs",
        additions: 44,
        deletions: 0,
      },
    ],
  }
}

function renderSwarmView() {
  const queryClient = createQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <SwarmView />
    </QueryClientProvider>
  )
}

describe("SwarmView orchestration surface", () => {
  let state: SwarmState

  beforeEach(() => {
    state = createInitialSwarmFixture()
    useAppStore.setState({
      activeCodeFile: null,
      activeCodeLine: null,
      rightMode: "context",
    })

    vi.spyOn(ipcClient.swarm, "getState").mockImplementation(async () =>
      structuredClone(state)
    )

    vi.spyOn(ipcClient.swarm, "spawnWorker").mockImplementation(
      async (input) => {
        state = {
          ...state,
          agents: [
            ...state.agents,
            {
              id: input.name,
              name: input.name,
              role: input.worktree,
              worktree: input.worktree,
              state: "running",
              task: input.task,
              model: input.model,
              laneProgressLabel: "0 / 2 lane items",
              duration: "1s",
              reportsTo: "coordinator",
              todoLane: [
                { id: `${input.name}_1`, text: input.task, status: "now" },
                {
                  id: `${input.name}_2`,
                  text: "Run cargo test and report diff summary to coordinator",
                  status: "pending",
                },
              ],
              commands: [
                {
                  id: `sh_${input.name}`,
                  kind: "command",
                  command: "cargo test --workspace",
                  displayCommand: "cargo test --workspace",
                  output: "running test suite...",
                  exitCode: 0,
                  statusLabel: "Running in isolated worktree",
                  isMono: true,
                },
              ],
            },
          ],
          messages: [
            {
              id: `msg_spawn_${input.name}`,
              time: "Just now",
              from: "coordinator",
              to: input.name,
              text: `Spawned ${input.name} (${input.model}) in ${input.worktree}: ${input.task}`,
              tag: "spawned",
              isOk: true,
            },
            ...state.messages,
          ],
        }
        return structuredClone(state)
      }
    )

    vi.spyOn(ipcClient.swarm, "toggleAgentState").mockImplementation(
      async (agentId) => {
        state = {
          ...state,
          agents: state.agents.map((a) => {
            if (a.id !== agentId) return a
            return {
              ...a,
              state: a.state === "stopped" ? "running" : "stopped",
            }
          }),
        }
        return structuredClone(state)
      }
    )

    vi.spyOn(ipcClient.swarm, "sendDm").mockImplementation(async (input) => {
      state = {
        ...state,
        messages: [
          {
            id: `dm_${Date.now()}`,
            time: "Just now",
            from: "you",
            to: input.agentId,
            text: input.message,
            tag: "steering-dm",
            isOk: true,
          },
          ...state.messages,
        ],
      }
      return structuredClone(state)
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders telemetry strip and switches AgentInspector when selecting different agents in AgentRoster", async () => {
    renderSwarmView()

    await screen.findByRole("heading", {
      name: "Gateway retry & session shards",
    })

    // Telemetry strip displays swarm metrics
    const strip = document.querySelector("[data-slot='swarm-telemetry-strip']")
    expect(strip).not.toBeNull()
    expect(strip?.textContent).toContain("4 agents")
    expect(strip?.textContent).toContain("2 worktrees")
    expect(strip?.textContent).toContain("0 file conflicts")
    expect(strip?.textContent).toContain("Shared Plan v3")
    expect(strip?.textContent).toContain("1.18 cr")
    expect(strip?.textContent).toContain("94% KV warm")

    // Default selected worker is worker-1
    const inspector = screen.getByRole("region", {
      name: "Selected agent trace",
    })
    expect(inspector.getAttribute("data-agent-id")).toBe("worker-1")
    expect(
      within(inspector).getByText(
        "Guard duplicate attempt key in src/retry/stream.rs"
      )
    ).toBeInTheDocument()
    expect(
      within(inspector).getAllByText(
        "$ cargo test -p rayu-gateway retry_budget -- --nocapture"
      ).length
    ).toBeGreaterThanOrEqual(1)
    expect(
      within(inspector).getByText(
        /test result: ok\. 6 passed; 0 failed/i
      )
    ).toBeInTheDocument()

    // Clicking read file pill opens code file in app store
    fireEvent.click(within(inspector).getByText("src/retry/stream.rs:42-118"))
    expect(useAppStore.getState().activeCodeFile).toBe("src/retry/stream.rs")
    expect(useAppStore.getState().activeCodeLine).toBe(1)

    // Select worker-2 from AgentRoster
    const roster = screen.getByRole("region", { name: "Swarm roster" })
    const worker2Btn = within(roster)
      .getByText("worker-2")
      .closest("button") as HTMLButtonElement
    fireEvent.click(worker2Btn)

    expect(inspector.getAttribute("data-agent-id")).toBe("worker-2")
    expect(within(inspector).getByText("GPT-6.1 Sol")).toBeInTheDocument()
    expect(
      within(inspector).getByText(
        "Measure p99 latency delta vs retired SessionCache"
      )
    ).toBeInTheDocument()
    expect(
      within(inspector).getAllByText(
        "$ cargo bench -p rayucode-core shard_lookup_50k"
      ).length
    ).toBeGreaterThanOrEqual(1)
    expect(
      within(inspector).getByText(/shard_lookup_50k time:/i)
    ).toBeInTheDocument()

    // Select coordinator from AgentRoster
    const coordBtn = within(roster)
      .getByText("coordinator")
      .closest("button") as HTMLButtonElement
    fireEvent.click(coordBtn)

    expect(inspector.getAttribute("data-agent-id")).toBe("coordinator")
    expect(
      within(inspector).getByText(
        "Coordinator holds the single VersionedPlan slot and never performs git merges directly."
      )
    ).toBeInTheDocument()
  })

  it("validates SpawnWorkerBar with Zod and appends a newly spawned worker to the roster and Message Board", async () => {
    renderSwarmView()

    await screen.findByRole("heading", {
      name: "Gateway retry & session shards",
    })

    // Open inline SpawnWorkerBar
    fireEvent.click(screen.getByRole("button", { name: /Spawn worker/i }))
    const nameInput = screen.getByLabelText("Worker name")
    const taskInput = screen.getByLabelText("Worker task")
    const spawnBtn = screen.getByRole("button", { name: /^Spawn$/i })

    // Submitting with empty task triggers Zod validation error
    fireEvent.click(spawnBtn)
    expect(screen.getByRole("alert")).toHaveTextContent(
      /at least 4 characters/i
    )
    expect(ipcClient.swarm.spawnWorker).not.toHaveBeenCalled()

    // Submitting with invalid characters in worker name triggers Zod validation error
    fireEvent.change(nameInput, { target: { value: "bad worker!" } })
    fireEvent.change(taskInput, {
      target: { value: "Verify retry jitter bounds under concurrent load" },
    })
    fireEvent.click(spawnBtn)
    expect(screen.getByRole("alert")).toHaveTextContent(
      /letters, numbers, hyphens, or underscores/i
    )
    expect(ipcClient.swarm.spawnWorker).not.toHaveBeenCalled()

    // Submit valid worker payload
    fireEvent.change(nameInput, { target: { value: "worker-3" } })
    fireEvent.click(spawnBtn)

    await waitFor(() => {
      expect(ipcClient.swarm.spawnWorker).toHaveBeenCalledWith({
        name: "worker-3",
        model: "Claude Sonnet 5",
        worktree: "new git worktree",
        task: "Verify retry jitter bounds under concurrent load",
      })
    })

    // Roster immediately includes worker-3 and updates agent count to 5
    const roster = screen.getByRole("region", { name: "Swarm roster" })
    await waitFor(() => {
      expect(within(roster).getByText("worker-3")).toBeInTheDocument()
    })
    expect(
      document.querySelector("[data-slot='swarm-telemetry-strip']")?.textContent
    ).toContain("5 agents")

    // Spawn event posted to Message Board
    const board = document.querySelector("[data-slot='ledger-board']")
    expect(board?.textContent).toContain("worker-3")
    expect(board?.textContent).toContain("spawned")
  })

  it("toggles Stop and Resume lifecycle state on the selected worker", async () => {
    renderSwarmView()

    await screen.findByRole("heading", {
      name: "Gateway retry & session shards",
    })

    const inspector = screen.getByRole("region", {
      name: "Selected agent trace",
    })
    const stopBtn = within(inspector).getByRole("button", { name: /Stop/i })
    fireEvent.click(stopBtn)

    await waitFor(() => {
      expect(ipcClient.swarm.toggleAgentState).toHaveBeenCalledWith("worker-1")
    })

    // Button flips to Resume and roster reflects stopped state
    const resumeBtn = await within(inspector).findByRole("button", {
      name: /Resume/i,
    })
    expect(resumeBtn).toBeInTheDocument()

    const worker1Row = document.querySelector(
      "[data-slot='agent-roster-row'][data-agent-id='worker-1']"
    )
    expect(worker1Row?.textContent).toContain("stopped")

    // Click Resume to transition back to running
    fireEvent.click(resumeBtn)

    await waitFor(() => {
      expect(
        within(inspector).getByRole("button", { name: /Stop/i })
      ).toBeInTheDocument()
    })
    expect(worker1Row?.textContent).toContain("running")
  })

  it("sends a steering DM to the Message Board and switches between Message Board, Shared Plan, and Worktrees tabs", async () => {
    renderSwarmView()

    await screen.findByRole("heading", {
      name: "Gateway retry & session shards",
    })

    // Send steering DM to worker-1
    const dmInput = screen.getByPlaceholderText("Message @worker-1 directly...")
    fireEvent.change(dmInput, {
      target: {
        value: "Prioritize the retry-after header edge case before finishing",
      },
    })
    fireEvent.click(screen.getByRole("button", { name: /Send DM/i }))

    await waitFor(() => {
      expect(ipcClient.swarm.sendDm).toHaveBeenCalledWith({
        agentId: "worker-1",
        message: "Prioritize the retry-after header edge case before finishing",
      })
    })

    // Steering DM appears in Message Board and input clears
    await waitFor(() => {
      const board = document.querySelector("[data-slot='ledger-board']")
      expect(board?.textContent).toContain(
        "Prioritize the retry-after header edge case before finishing"
      )
      expect(board?.textContent).toContain("steering-dm")
    })
    expect((dmInput as HTMLInputElement).value).toBe("")

    // Switch to Shared Plan (v3) tab
    const planTab = screen.getByRole("tab", { name: /Shared Plan \(v3\)/i })
    fireEvent.mouseDown(planTab, { button: 0, ctrlKey: false })
    fireEvent.click(planTab)

    await waitFor(() => {
      expect(
        screen.getByText(
          "Deduplicate streaming mid-flight retries in rayu-gateway and verify 6 unit tests."
        )
      ).toBeInTheDocument()
    })

    // Switch to Worktrees tab and click Inspect diff
    const worktreesTab = screen.getByRole("tab", { name: /Worktrees \(2\)/i })
    fireEvent.mouseDown(worktreesTab, { button: 0, ctrlKey: false })
    fireEvent.click(worktreesTab)

    const inspectButtons = await screen.findAllByRole("button", {
      name: /Inspect diff/i,
    })
    expect(inspectButtons).toHaveLength(2)

    fireEvent.click(inspectButtons[0])
    expect(useAppStore.getState().activeCodeFile).toBe("src/retry/stream.rs")
    expect(useAppStore.getState().activeCodeLine).toBe(1)
  })

  it("pauses and resumes all running workers from the Swarm header", async () => {
    renderSwarmView()

    await screen.findByRole("heading", {
      name: "Gateway retry & session shards",
    })

    const pauseAllBtn = screen.getByRole("button", { name: /Pause All/i })
    fireEvent.click(pauseAllBtn)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Resume All/i })
      ).toBeInTheDocument()
    })
    expect(
      document.querySelector("[data-slot='swarm-telemetry-strip']")?.textContent
    ).toContain("0 running")

    fireEvent.click(screen.getByRole("button", { name: /Resume All/i }))

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Pause All/i })
      ).toBeInTheDocument()
    })
    expect(
      document.querySelector("[data-slot='swarm-telemetry-strip']")?.textContent
    ).toContain("2 running")
  })

  it("renders a focused SwarmLaunchpad when idle and transitions into the active view upon launching a goal", async () => {
    state = {
      swarmId: "idle",
      title: "No active swarm",
      planVersion: "plan v1",
      credits: "0.00 cr",
      kvCachePct: 0,
      agents: [],
      messages: [],
      planScopes: [],
      worktrees: [],
    }

    renderSwarmView()

    // Shows the clean launchpad instead of empty telemetry / ledger chrome
    await screen.findByRole("heading", { name: "Run parallel agents" })
    expect(
      document.querySelector("[data-slot='swarm-telemetry-strip']")
    ).toBeNull()
    expect(
      document.querySelector("[data-slot='coordination-ledger']")
    ).toBeNull()

    // Clicking Start swarm without a goal shows validation feedback
    fireEvent.click(screen.getByRole("button", { name: /Start swarm/i }))
    expect(screen.getByRole("alert")).toHaveTextContent(/at least 4 characters/i)
    expect(ipcClient.swarm.spawnWorker).not.toHaveBeenCalled()

    // Selecting a template fills the goal and picks the preset
    fireEvent.click(
      screen.getByRole("button", {
        name: /Build a feature with parallel tests/i,
      })
    )
    const goalInput = screen.getByLabelText("Swarm goal") as HTMLTextAreaElement
    expect(goalInput.value).toContain("isolated worktree")

    // Custom goal + Single worker preset launches cleanly into active view
    fireEvent.click(screen.getByRole("radio", { name: /Single worker/i }))
    fireEvent.change(goalInput, {
      target: { value: "Refactor auth middleware and add unit tests" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Start swarm/i }))

    await waitFor(() => {
      expect(ipcClient.swarm.spawnWorker).toHaveBeenCalledWith({
        name: "worker-1",
        model: "Claude Sonnet 5",
        worktree: "new git worktree",
        task: "Refactor auth middleware and add unit tests",
      })
    })

    // Transitions out of Launchpad into the live orchestration workbench
    const roster = await screen.findByRole("region", { name: "Swarm roster" })
    expect(within(roster).getByText("worker-1")).toBeInTheDocument()
    expect(
      document.querySelector("[data-slot='swarm-launchpad']")
    ).toBeNull()
  })
})
