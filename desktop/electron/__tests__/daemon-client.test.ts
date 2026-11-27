import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  HarnessError,
  RayucodeClient,
  type SdkTool,
  type Transport,
} from "@rayu-dev/rayucode-sdk"

import {
  RayuDaemonClient,
  wrapTransportWithSupportsPermissions,
} from "../daemon-client"

describe("RayuDaemonClient startup coalescing & reconnecting state", () => {
  const originalEnv = { ...process.env }
  let tmpHome: string

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-daemon-test-"))
    process.env.RAYU_HOME = tmpHome
    process.env.XDG_CONFIG_HOME = path.join(tmpHome, "xdg")
    delete process.env.RAYU_API_KEY
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("coalesces concurrent checkConnection/getOrProbeStatus calls to a single launch without sticking reconnecting=true", async () => {
    process.env.RAYU_BINARY = process.execPath
    fs.writeFileSync(
      path.join(tmpHome, "rayu-auth.json"),
      JSON.stringify({ accessToken: "tok", refreshToken: "ref" })
    )

    vi.spyOn(RayucodeClient, "connect").mockRejectedValue(
      new Error("ENOENT: no shared socket")
    )

    const fakeClient = Object.assign(new EventEmitter(), {
      server: "rayu-harness-v1",
      ping: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    }) as unknown as RayucodeClient

    let resolveLaunch!: (client: RayucodeClient) => void
    const launchSpy = vi.spyOn(RayucodeClient, "launch").mockImplementation(
      () =>
        new Promise<RayucodeClient>((resolve) => {
          resolveLaunch = resolve
        })
    )

    const daemon = new RayuDaemonClient("/tmp/nonexistent-rayu-api.sock")
    const seenStatuses: Array<{ connected: boolean; reconnecting: boolean }> = []
    daemon.on("status", (s) =>
      seenStatuses.push({ connected: s.connected, reconnecting: s.reconnecting })
    )

    // Simulate main.ts + App.tsx + DaemonBanner.tsx all probing at startup
    const p1 = daemon.checkConnection("/tmp")
    const p2 = daemon.getOrProbeStatus("/tmp")
    const p3 = daemon.getOrProbeStatus("/tmp")

    // Give connect() rejection a tick to enter launchAndConnect()
    await new Promise((r) => setTimeout(r, 15))
    expect(launchSpy).toHaveBeenCalledTimes(1)

    // Cold startup must NOT flash reconnecting=true banner before ever connecting
    expect(seenStatuses.some((s) => s.reconnecting)).toBe(false)

    resolveLaunch(fakeClient)
    const [r1, r2, r3] = await Promise.all([p1, p2, p3])

    expect(r1.connected).toBe(true)
    expect(r2.connected).toBe(true)
    expect(r3.connected).toBe(true)
    expect(r1.reconnecting).toBe(false)
    expect(r1.socketPath).toContain("desktop-instance")
  })

  it("does not stick reconnecting=true when offline and signed out", async () => {
    vi.spyOn(RayucodeClient, "connect").mockRejectedValue(
      new Error("ENOENT: no shared socket")
    )
    const launchSpy = vi.spyOn(RayucodeClient, "launch")

    const daemon = new RayuDaemonClient("/tmp/nonexistent-rayu-api.sock")
    const status = await daemon.checkConnection("/tmp")

    expect(launchSpy).not.toHaveBeenCalled()
    expect(status.connected).toBe(false)
    expect(status.reconnecting).toBe(false)
    expect(status.lastError).toMatch(/Sign in to Rayu Cloud/i)
  })

  it("persists initial title on createSession, skips redundant attachSession on getHistory/sendMessage, and dials a fresh socket for a second session", async () => {
    const client1 = Object.assign(new EventEmitter(), {
      server: "rayu-harness-v1",
      ping: vi.fn().mockResolvedValue(undefined),
      createSession: vi.fn().mockResolvedValue({
        session_id: "session_first",
        working_dir: "/tmp/proj",
        status: "idle",
      }),
      renameSession: vi.fn().mockResolvedValue(undefined),
      attachSession: vi.fn().mockResolvedValue({
        session_id: "session_first",
        working_dir: "/tmp/proj",
        status: "idle",
      }),
      getHistoryWithImages: vi
        .fn()
        .mockResolvedValue({ messages: [], images: [] }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    }) as unknown as RayucodeClient

    const client2 = Object.assign(new EventEmitter(), {
      server: "rayu-harness-v1",
      ping: vi.fn().mockResolvedValue(undefined),
      createSession: vi.fn().mockResolvedValue({
        session_id: "session_second",
        working_dir: "/tmp/proj",
        status: "idle",
      }),
      renameSession: vi.fn().mockResolvedValue(undefined),
      attachSession: vi.fn(),
      getHistoryWithImages: vi
        .fn()
        .mockResolvedValue({ messages: [], images: [] }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    }) as unknown as RayucodeClient

    const connectSpy = vi
      .spyOn(RayucodeClient, "connect")
      .mockResolvedValueOnce(client1)
      .mockResolvedValueOnce(client2)

    const daemon = new RayuDaemonClient("/tmp/shared-rayu-api.sock")

    // 1st session creation: names and persists immediately in Rust via renameSession
    const created1 = await daemon.createSession("/tmp/proj", "Fix session storage")
    expect(created1.session_id).toBe("session_first")
    expect(created1.title).toBe("Fix session storage")
    expect(client1.renameSession).toHaveBeenCalledWith(
      "session_first",
      "Fix session storage"
    )

    // Subsequent getHistory + sendMessage for the same session must NOT send a redundant attachSession
    await daemon.getHistory("session_first")
    await daemon.sendMessage("session_first", "Fix session storage")
    expect(client1.attachSession).not.toHaveBeenCalled()
    expect(client1.sendMessage).toHaveBeenCalledWith(
      "session_first",
      "Fix session storage",
      { waitForAccept: true }
    )

    // Multimodal image attachments forward directly to Rust core sendMessage({ images })
    await daemon.sendMessage("session_first", "Inspect this screenshot", [
      ["image/png", "iVBORw0KGgo="],
    ])
    expect(client1.sendMessage).toHaveBeenLastCalledWith(
      "session_first",
      "Inspect this screenshot",
      {
        waitForAccept: true,
        images: [["image/png", "iVBORw0KGgo="]],
      }
    )

    // 2nd session creation: opens a fresh socket so the Rust daemon mints a new session_id
    const created2 = await daemon.createSession("/tmp/proj", "Second session")
    expect(connectSpy).toHaveBeenCalledTimes(2)
    expect(created2.session_id).toBe("session_second")
    expect(created2.title).toBe("Second session")
    expect(client2.renameSession).toHaveBeenCalledWith(
      "session_second",
      "Second session"
    )
  })

  it("registers Desktop SdkTools via configureTools on BOTH createSession and attachSession", async () => {
    const configureTools = vi.fn().mockResolvedValue(undefined)
    const request = vi.fn().mockResolvedValue({ v: 1, ev: "ok" })
    const fakeClient = Object.assign(new EventEmitter(), {
      server: "rayu-harness-v1",
      capabilities: ["session_tools", "permissions", "permission_modes"],
      supports: (cap: string) =>
        ["session_tools", "permissions", "permission_modes"].includes(cap),
      ping: vi.fn().mockResolvedValue(undefined),
      createSession: vi.fn().mockResolvedValue({
        session_id: "sess_created",
        working_dir: "/tmp/ws",
        status: "idle",
      }),
      attachSession: vi.fn().mockResolvedValue({
        session_id: "sess_attached",
        working_dir: "/tmp/ws",
        status: "idle",
      }),
      configureTools,
      request,
      close: vi.fn(),
    }) as unknown as RayucodeClient

    vi.spyOn(RayucodeClient, "connect").mockResolvedValue(fakeClient)

    const daemon = new RayuDaemonClient("/tmp/tools-test-rayu.sock")
    daemon.configureDesktopRuntime({
      getWorkspaceDir: () => "/tmp/ws",
    })

    await daemon.createSession("/tmp/ws")
    expect(configureTools).toHaveBeenCalledTimes(1)
    const [firstSessionId, firstOpts] = configureTools.mock.calls[0] as [
      string,
      { custom: SdkTool[] },
    ]
    expect(firstSessionId).toBe("sess_created")
    const toolNames = firstOpts.custom.map((t) => t.name)
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "read_excel",
        "write_excel",
        "create_powerpoint",
        "list_templates",
        "save_template",
        "browser_navigate",
        "browser_snapshot",
        "browser_click",
        "browser_type",
      ])
    )

    await daemon.attachSession("sess_attached")
    expect(configureTools).toHaveBeenCalledTimes(2)
    expect(configureTools.mock.calls[1]?.[0]).toBe("sess_attached")
  })

  it("syncs setPermissionMode, retries busy sessions on turn_done, and re-syncs on attach", async () => {
    const configureTools = vi.fn().mockResolvedValue(undefined)
    const request = vi
      .fn()
      // 1st call: plan succeeds immediately
      .mockResolvedValueOnce({ v: 1, ev: "ok" })
      // 2nd call: acceptEdits returns structured busy
      .mockResolvedValueOnce({
        v: 1,
        ev: "error",
        code: "busy",
        message: "Session is busy",
      })
      // 3rd call (retry on turn_done): succeeds
      .mockResolvedValueOnce({ v: 1, ev: "ok" })
      // 4th call (re-sync on attachSession): succeeds
      .mockResolvedValueOnce({ v: 1, ev: "ok" })
      // 5th call (hard error): returns error
      .mockResolvedValueOnce({
        v: 1,
        ev: "error",
        code: "invalid_request",
        message: "Unsupported permission mode",
      })

    const fakeClient = Object.assign(new EventEmitter(), {
      server: "rayu-harness-v1",
      capabilities: ["session_tools", "permissions", "permission_modes"],
      supports: () => true,
      ping: vi.fn().mockResolvedValue(undefined),
      createSession: vi.fn().mockResolvedValue({
        session_id: "sess_perm_1",
        working_dir: "/tmp/ws",
        status: "idle",
      }),
      attachSession: vi.fn().mockResolvedValue({
        session_id: "sess_perm_2",
        working_dir: "/tmp/ws",
        status: "idle",
      }),
      configureTools,
      request,
      close: vi.fn(),
    }) as unknown as RayucodeClient

    vi.spyOn(RayucodeClient, "connect").mockResolvedValue(fakeClient)

    const daemon = new RayuDaemonClient("/tmp/perm-test-rayu.sock")
    await daemon.createSession("/tmp/ws")

    const res1 = await daemon.setPermissionMode("sess_perm_1", "plan")
    expect(res1).toEqual({ ok: true })
    expect(request).toHaveBeenNthCalledWith(1, {
      req: "set_permission_mode",
      session_id: "sess_perm_1",
      mode: "plan",
    })

    // Busy response queues retry until turn_done
    const res2 = await daemon.setPermissionMode("sess_perm_1", "acceptEdits")
    expect(res2).toEqual({ ok: true, code: "busy" })
    expect(request).toHaveBeenNthCalledWith(2, {
      req: "set_permission_mode",
      session_id: "sess_perm_1",
      mode: "accept_edits",
    })

    fakeClient.emit("event", {
      v: 1,
      ev: "turn_done",
      session_id: "sess_perm_1",
    })
    await new Promise((r) => setTimeout(r, 15))
    expect(request).toHaveBeenNthCalledWith(3, {
      req: "set_permission_mode",
      session_id: "sess_perm_1",
      mode: "accept_edits",
    })

    // Attaching another session re-syncs desiredPermissionMode ("acceptEdits")
    await daemon.attachSession("sess_perm_2")
    expect(request).toHaveBeenNthCalledWith(4, {
      req: "set_permission_mode",
      session_id: "sess_perm_2",
      mode: "accept_edits",
    })

    // Hard rejection surfaces { ok: false, code, error }
    const resErr = await daemon.setPermissionMode("sess_perm_2", "orchestrator")
    expect(resErr).toEqual({
      ok: false,
      code: "invalid_request",
      error: "Unsupported permission mode",
    })
  })

  it("injects supports_permissions: true into outgoing hello frames via transport wrapper", () => {
    const written: string[] = []
    const base: Transport = {
      write: (data) => written.push(data),
      onData: () => {},
      onClose: () => {},
      close: () => {},
    }
    const wrapped = wrapTransportWithSupportsPermissions(base)
    wrapped.write(
      `${JSON.stringify({
        v: 1,
        id: 1,
        req: "hello",
        min_version: 1,
        max_version: 1,
        client: "rayucode-desktop/0.1.0",
        supports_user_response: true,
      })}\n`
    )
    wrapped.write(`${JSON.stringify({ v: 1, id: 2, req: "ping" })}\n`)

    const first = JSON.parse(written[0]!.trim()) as Record<string, unknown>
    const second = JSON.parse(written[1]!.trim()) as Record<string, unknown>
    expect(first.supports_permissions).toBe(true)
    expect(first.supports_user_response).toBe(true)
    expect(second).toEqual({ v: 1, id: 2, req: "ping" })
  })

  it("forwards file_changes_state frames and bridges getFileChanges/getFileChangeDiff/fileChangeAction with capability fallback", async () => {
    const sampleSnapshot = {
      session_id: "sess_fc_1",
      latest_turn_id: 2,
      total_pending_files: 1,
      total_additions: 4,
      total_deletions: 1,
      files: [],
    }
    const sampleDiff = {
      path: "/repo/src/lib.rs",
      display_path: "src/lib.rs",
      kind: "modified" as const,
      status: "pending" as const,
      additions: 4,
      deletions: 1,
      is_binary: false,
      original_content: "old\n",
      modified_content: "new\n",
      unified_diff: "@@ -1 +1 @@\n-old\n+new\n",
      hunks: [],
    }
    const sampleResponse = {
      ok: true,
      message: "Kept src/lib.rs",
      conflicts: [],
      snapshot: { ...sampleSnapshot, total_pending_files: 0 },
    }

    const capableClient = Object.assign(new EventEmitter(), {
      server: "rayu-harness-v1",
      capabilities: ["file_changes"],
      supports: (cap: string) => cap === "file_changes",
      ping: vi.fn().mockResolvedValue(undefined),
      attachSession: vi.fn().mockResolvedValue({
        session_id: "sess_fc_1",
        working_dir: "/repo",
        status: "idle",
      }),
      getFileChanges: vi.fn().mockResolvedValue(sampleSnapshot),
      getFileChangeDiff: vi.fn().mockResolvedValue(sampleDiff),
      fileChangeAction: vi.fn().mockResolvedValue(sampleResponse),
      close: vi.fn(),
    }) as unknown as RayucodeClient

    vi.spyOn(RayucodeClient, "connect").mockResolvedValue(capableClient)

    // Cold-start client auto-connects and attaches before querying file changes
    const coldDaemon = new RayuDaemonClient("/tmp/fc-cold-rayu.sock")
    expect(await coldDaemon.getFileChanges("sess_fc_1")).toEqual(sampleSnapshot)

    const daemon = new RayuDaemonClient("/tmp/fc-test-rayu.sock")
    const receivedFrames: Array<Record<string, unknown>> = []
    daemon.on("harness-event", (frame: Record<string, unknown>) => {
      receivedFrames.push(frame)
    })

    await daemon.attachSession("sess_fc_1")

    capableClient.emit("event", {
      v: 1,
      ev: "file_changes_state",
      session_id: "sess_fc_1",
      snapshot: sampleSnapshot,
    })
    expect(receivedFrames).toContainEqual(
      expect.objectContaining({
        ev: "file_changes_state",
        session_id: "sess_fc_1",
      })
    )

    expect(await daemon.getFileChanges("sess_fc_1")).toEqual(sampleSnapshot)
    expect(await daemon.getFileChangeDiff("sess_fc_1", "/repo/src/lib.rs")).toEqual(
      sampleDiff
    )
    expect(
      await daemon.fileChangeAction("sess_fc_1", "keep", {
        path: "/repo/src/lib.rs",
      })
    ).toEqual(sampleResponse)

    // Older daemon lacking file_changes capability degrades gracefully
    const legacyClient = Object.assign(new EventEmitter(), {
      server: "rayu-harness-legacy",
      capabilities: ["session_tools"],
      supports: (cap: string) => cap === "session_tools",
      ping: vi.fn().mockResolvedValue(undefined),
      attachSession: vi.fn().mockResolvedValue({
        session_id: "sess_legacy",
        working_dir: "/repo",
        status: "idle",
      }),
      getFileChanges: vi.fn(),
      getFileChangeDiff: vi.fn(),
      fileChangeAction: vi.fn(),
      close: vi.fn(),
    }) as unknown as RayucodeClient

    vi.spyOn(RayucodeClient, "connect").mockResolvedValue(legacyClient)
    const legacyDaemon = new RayuDaemonClient("/tmp/fc-legacy-rayu.sock")
    await legacyDaemon.attachSession("sess_legacy")

    const empty = await legacyDaemon.getFileChanges("sess_legacy")
    expect(empty.files).toEqual([])
    expect(
      await legacyDaemon.getFileChangeDiff("sess_legacy", "/repo/src/lib.rs")
    ).toBeNull()
    const unsupportedAction = await legacyDaemon.fileChangeAction(
      "sess_legacy",
      "keep",
      { path: "/repo/src/lib.rs" }
    )
    expect(unsupportedAction.ok).toBe(false)
    expect(unsupportedAction.message).toMatch(/does not support file_changes/i)
  })

  it("refreshes and emits todo_state on todo/batch tool_done events and degrades cleanly without todo_state capability", async () => {
    const todoState = vi.fn().mockResolvedValue({
      todos: [
        { id: "1", content: "Inspect schema", status: "done" },
        {
          id: "2",
          name: "Render checklist",
          status: "running",
          active_form: "Rendering checklist",
        },
        { id: "3", title: "Skipped item", status: "canceled" },
      ],
    })
    const liveClient = Object.assign(new EventEmitter(), {
      server: "rayu-harness-v1",
      capabilities: ["todo_state"],
      supports: (cap: string) => cap === "todo_state",
      ping: vi.fn().mockResolvedValue(undefined),
      attachSession: vi.fn().mockResolvedValue({
        session_id: "sess_todo_1",
        working_dir: "/repo",
        status: "idle",
      }),
      todoState,
      close: vi.fn(),
    }) as unknown as RayucodeClient

    vi.spyOn(RayucodeClient, "connect").mockResolvedValue(liveClient)
    const daemon = new RayuDaemonClient("/tmp/todo-live-rayu.sock")
    const emitted: Array<Record<string, unknown>> = []
    daemon.on("harness-event", (frame: Record<string, unknown>) => {
      emitted.push(frame)
    })

    await daemon.attachSession("sess_todo_1")

    const initial = await daemon.getTodos("sess_todo_1")
    expect(initial.todos).toEqual([
      { id: "1", content: "Inspect schema", status: "completed" },
      {
        id: "2",
        content: "Render checklist",
        status: "in_progress",
        activeForm: "Rendering checklist",
      },
      { id: "3", content: "Skipped item", status: "cancelled" },
    ])

    ;(liveClient as unknown as EventEmitter).emit("event", {
      ev: "tool_done",
      session_id: "sess_todo_1",
      call_id: "c_todo_1",
      name: "todo",
      output: "ok",
    })
    await new Promise((r) => setTimeout(r, 10))

    let todoEvents = emitted.filter((f) => f.ev === "todo_state")
    expect(todoEvents.length).toBe(1)
    expect(todoEvents[0]).toMatchObject({
      ev: "todo_state",
      session_id: "sess_todo_1",
      state: {
        todos: initial.todos,
      },
    })

    // Batch tool_done containing a todo sub-call also triggers todoState pull
    ;(liveClient as unknown as EventEmitter).emit("event", {
      ev: "tool_done",
      session_id: "sess_todo_1",
      call_id: "c_batch_1",
      name: "batch",
      tool_input: { tool_calls: [{ name: "todo", input: { action: "update" } }] },
      output: "ok",
    })
    await new Promise((r) => setTimeout(r, 10))

    todoEvents = emitted.filter((f) => f.ev === "todo_state")
    expect(todoEvents.length).toBe(2)

    // Older daemon lacking todo_state capability returns empty safely
    const legacyClient = Object.assign(new EventEmitter(), {
      server: "rayu-harness-legacy",
      capabilities: ["session_tools"],
      supports: (cap: string) => cap === "session_tools",
      ping: vi.fn().mockResolvedValue(undefined),
      attachSession: vi.fn().mockResolvedValue({
        session_id: "sess_todo_legacy",
        working_dir: "/repo",
        status: "idle",
      }),
      todoState: vi.fn(),
      close: vi.fn(),
    }) as unknown as RayucodeClient

    vi.spyOn(RayucodeClient, "connect").mockResolvedValue(legacyClient)
    const legacyDaemon = new RayuDaemonClient("/tmp/todo-legacy-rayu.sock")
    await legacyDaemon.attachSession("sess_todo_legacy")
    expect(await legacyDaemon.getTodos("sess_todo_legacy")).toEqual({
      sessionId: "sess_todo_legacy",
      todos: [],
    })
  })

  it("supersedes stale queued getHistory calls during rapid switches without dialing extra sockets or blocking on post-attach sync", async () => {
    let releaseFirstAttach!: () => void
    const firstClient = Object.assign(new EventEmitter(), {
      server: "rayu-harness-v1",
      capabilities: ["session_tools", "permission_modes"],
      supports: () => true,
      ping: vi.fn().mockResolvedValue(undefined),
      attachSession: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            releaseFirstAttach = () =>
              resolve({
                session_id: "sess_first",
                working_dir: "/repo",
                status: "idle",
              })
          })
      ),
      configureTools: vi.fn(() => new Promise(() => {})),
      request: vi.fn(() => new Promise(() => {})),
      getHistoryWithImages: vi
        .fn()
        .mockResolvedValue({ messages: [{ role: "user", content: "first" }], images: [] }),
      close: vi.fn(),
    }) as unknown as RayucodeClient

    const middleClient = Object.assign(new EventEmitter(), {
      server: "rayu-harness-v1",
      capabilities: ["session_tools", "permission_modes"],
      supports: () => true,
      ping: vi.fn().mockResolvedValue(undefined),
      attachSession: vi.fn(),
      getHistoryWithImages: vi.fn(),
      close: vi.fn(),
    }) as unknown as RayucodeClient

    const finalClient = Object.assign(new EventEmitter(), {
      server: "rayu-harness-v1",
      capabilities: ["session_tools", "permission_modes"],
      supports: () => true,
      ping: vi.fn().mockResolvedValue(undefined),
      attachSession: vi.fn().mockResolvedValue({
        session_id: "sess_final",
        working_dir: "/repo",
        status: "idle",
      }),
      configureTools: vi.fn(() => new Promise(() => {})),
      request: vi.fn(() => new Promise(() => {})),
      getHistoryWithImages: vi.fn().mockResolvedValue({
        messages: [{ role: "user", content: "final prompt" }],
        images: [],
      }),
      close: vi.fn(),
    }) as unknown as RayucodeClient

    const connectSpy = vi
      .spyOn(RayucodeClient, "connect")
      .mockResolvedValueOnce(firstClient)
      .mockResolvedValueOnce(finalClient)
      .mockResolvedValueOnce(middleClient)

    const daemon = new RayuDaemonClient("/tmp/rapid-switch-rayu.sock")
    const pFirst = daemon.getHistory("sess_first")
    await new Promise((r) => setTimeout(r, 5))
    const pMiddle = daemon.getHistory("sess_middle")
    const pFinal = daemon.getHistory("sess_final")

    releaseFirstAttach()
    const [resFirst, resMiddle, resFinal] = await Promise.all([
      pFirst,
      pMiddle,
      pFinal,
    ])

    expect(resFirst.messages).toEqual([])
    expect(resMiddle.messages).toEqual([])
    expect(resFinal.messages).toEqual([{ role: "user", content: "final prompt" }])
    expect(middleClient.attachSession).not.toHaveBeenCalled()
    expect(connectSpy).toHaveBeenCalledTimes(2)
  })

  it("returns explicit { ok: false, error } when setModel is rejected by the daemon", async () => {
    const fakeClient = Object.assign(new EventEmitter(), {
      server: "rayu-harness-v1",
      capabilities: ["session_tools", "permission_modes"],
      supports: () => true,
      ping: vi.fn().mockResolvedValue(undefined),
      attachSession: vi.fn().mockResolvedValue({
        session_id: "sess_err",
        working_dir: "/repo",
        status: "idle",
      }),
      configureTools: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockResolvedValue({ v: 1, ev: "ok" }),
      setModel: vi
        .fn()
        .mockRejectedValue(new Error("unknown model: qwen4-max-preview")),
      close: vi.fn(),
    }) as unknown as RayucodeClient

    vi.spyOn(RayucodeClient, "connect").mockResolvedValue(fakeClient)

    const daemon = new RayuDaemonClient("/tmp/set-model-error-rayu.sock")
    const result = await daemon.setModel("sess_err", "qwen4-max-preview")

    expect(result).toEqual({
      ok: false,
      error: "unknown model: qwen4-max-preview",
    })
  })

  it("keeps an active streaming session socket open when creating, attaching, or fetching history for another session", async () => {
    const client1 = Object.assign(new EventEmitter(), {
      server: "rayu-harness-v1",
      capabilities: ["session_tools", "permission_modes"],
      supports: () => true,
      ping: vi.fn().mockResolvedValue(undefined),
      createSession: vi.fn().mockResolvedValue({
        session_id: "sess_stream_1",
        working_dir: "/repo",
        status: "idle",
      }),
      renameSession: vi.fn().mockResolvedValue(undefined),
      attachSession: vi.fn().mockResolvedValue({
        session_id: "sess_stream_1",
        working_dir: "/repo",
        status: "idle",
      }),
      configureTools: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockResolvedValue({ v: 1, ev: "ok" }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getHistoryWithImages: vi
        .fn()
        .mockResolvedValue({ messages: [{ role: "user", content: "hi" }], images: [] }),
      cancel: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    }) as unknown as RayucodeClient

    const client2 = Object.assign(new EventEmitter(), {
      server: "rayu-harness-v1",
      capabilities: ["session_tools", "permission_modes"],
      supports: () => true,
      ping: vi.fn().mockResolvedValue(undefined),
      createSession: vi.fn().mockResolvedValue({
        session_id: "sess_new_2",
        working_dir: "/repo",
        status: "idle",
      }),
      renameSession: vi.fn().mockResolvedValue(undefined),
      attachSession: vi.fn(),
      configureTools: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockResolvedValue({ v: 1, ev: "ok" }),
      getHistoryWithImages: vi
        .fn()
        .mockResolvedValue({ messages: [], images: [] }),
      cancel: vi.fn(),
      close: vi.fn(),
    }) as unknown as RayucodeClient

    const client3 = Object.assign(new EventEmitter(), {
      server: "rayu-harness-v1",
      capabilities: ["session_tools", "permission_modes"],
      supports: () => true,
      ping: vi.fn().mockResolvedValue(undefined),
      attachSession: vi.fn().mockResolvedValue({
        session_id: "sess_other_3",
        working_dir: "/repo",
        status: "idle",
      }),
      configureTools: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockResolvedValue({ v: 1, ev: "ok" }),
      getHistoryWithImages: vi
        .fn()
        .mockResolvedValue({ messages: [], images: [] }),
      cancel: vi.fn(),
      close: vi.fn(),
    }) as unknown as RayucodeClient

    const connectSpy = vi
      .spyOn(RayucodeClient, "connect")
      .mockResolvedValueOnce(client1)
      .mockResolvedValueOnce(client2)
      .mockResolvedValueOnce(client3)

    const daemon = new RayuDaemonClient("/tmp/pool-stream-rayu.sock")
    const receivedFrames: Array<Record<string, unknown>> = []
    daemon.on("harness-event", (frame: Record<string, unknown>) => {
      receivedFrames.push(frame)
    })

    await daemon.createSession("/repo", "Chat 1")
    await daemon.sendMessage("sess_stream_1", "Long task")

    // Creating a second chat and viewing a third chat must keep client1 open
    await daemon.createSession("/repo", "Chat 2")
    await daemon.getHistory("sess_other_3")
    expect(client1.close).not.toHaveBeenCalled()

    // Background stream frames emitted on client1 still arrive on daemon
    client1.emit("event", {
      v: 1,
      ev: "text_delta",
      session_id: "sess_stream_1",
      text: "still alive",
    })
    expect(receivedFrames).toContainEqual(
      expect.objectContaining({
        ev: "text_delta",
        session_id: "sess_stream_1",
        text: "still alive",
      })
    )

    // Returning to sess_stream_1 reuses pooled client1 without dialing a 4th socket
    await daemon.getHistory("sess_stream_1")
    expect(connectSpy).toHaveBeenCalledTimes(3)
    expect(client1.attachSession).not.toHaveBeenCalled()

    // Cancel routes to client1 (owning sess_stream_1) rather than client3
    await daemon.cancel("sess_stream_1")
    expect(client1.cancel).toHaveBeenCalledWith("sess_stream_1")
    expect(client3.cancel).not.toHaveBeenCalled()

    client1.emit("event", {
      v: 1,
      ev: "turn_done",
      session_id: "sess_stream_1",
    })
    expect(receivedFrames).toContainEqual(
      expect.objectContaining({
        ev: "turn_done",
        session_id: "sess_stream_1",
      })
    )
  })

  it("synthesizes turn_stopped failure frame when a streaming session socket closes mid-turn", async () => {
    const client = Object.assign(new EventEmitter(), {
      server: "rayu-harness-v1",
      capabilities: ["session_tools", "permission_modes"],
      supports: () => true,
      ping: vi.fn().mockResolvedValue(undefined),
      createSession: vi.fn().mockResolvedValue({
        session_id: "sess_drop_1",
        working_dir: "/repo",
        status: "idle",
      }),
      renameSession: vi.fn().mockResolvedValue(undefined),
      configureTools: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockResolvedValue({ v: 1, ev: "ok" }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    }) as unknown as RayucodeClient

    vi.spyOn(RayucodeClient, "connect").mockResolvedValue(client)

    const daemon = new RayuDaemonClient("/tmp/drop-test-rayu.sock")
    const receivedFrames: Array<Record<string, unknown>> = []
    daemon.on("harness-event", (frame: Record<string, unknown>) => {
      receivedFrames.push(frame)
    })

    await daemon.createSession("/repo", "Drop test")
    await daemon.sendMessage("sess_drop_1", "Run long task")

    // Socket closes mid-turn without turn_done -> SessionSocketPool synthesizes turn_stopped
    client.emit("close")

    expect(receivedFrames).toContainEqual(
      expect.objectContaining({
        ev: "turn_stopped",
        reason: "failure",
        session_id: "sess_drop_1",
      })
    )
  })

  it("bridges v1.16 getCapabilities, getConfig, patchConfig, and returns structured ErrorCode::Busy / Unsupported without regex scraping", async () => {
    const mockCaps = {
      commands: [
        {
          name: "compact",
          description: "Compact session history",
          category: "session",
          dispatch: { kind: "api_request", req: "compact" },
        },
      ],
      permission_modes: [
        { id: "default", label: "Ask", description: "Prompt before edits", is_default: true },
      ],
      features: [{ key: "memory", enabled: true, description: "Memory" }],
    }
    const mockConfig = {
      path: "/tmp/.rayu/config.toml",
      sections: ["provider", "compaction"],
      values: { "provider.default_model": "claude-sonnet-4-6" },
      schema: [],
    }
    const client = Object.assign(new EventEmitter(), {
      server: "rayu-harness-v1",
      capabilities: ["capabilities_v1", "config_v1"],
      supports: () => true,
      ping: vi.fn().mockResolvedValue(undefined),
      attachSession: vi.fn().mockResolvedValue({
        session_id: "sess_v16",
        working_dir: "/repo",
        status: "idle",
      }),
      getCapabilities: vi.fn().mockResolvedValue(mockCaps),
      getConfig: vi.fn().mockResolvedValue(mockConfig),
      patchConfig: vi.fn().mockResolvedValue(mockConfig),
      setReasoningEffort: vi
        .fn()
        .mockRejectedValue(new HarnessError("busy", "Session is busy")),
      setModel: vi
        .fn()
        .mockRejectedValue(new HarnessError("busy", "Turn in progress")),
      getFileChanges: vi
        .fn()
        .mockRejectedValue(new HarnessError("unsupported", "Not supported")),
      close: vi.fn(),
    }) as unknown as RayucodeClient

    vi.spyOn(RayucodeClient, "connect").mockResolvedValue(client)

    const daemon = new RayuDaemonClient("/tmp/v16-test-rayu.sock")
    expect(await daemon.getCapabilities("sess_v16")).toEqual(mockCaps)
    expect(await daemon.getConfig(["provider"])).toEqual(mockConfig)
    expect(await daemon.patchConfig({ "provider.default_model": "gpt-5" })).toEqual({
      ok: true,
      state: mockConfig,
    })

    const effortRes = await daemon.setReasoningEffort("sess_v16", "xhigh")
    expect(effortRes).toMatchObject({ ok: false, code: "busy" })

    const modelRes = await daemon.setModel("sess_v16", "gpt-5")
    expect(modelRes).toMatchObject({ ok: false, code: "busy" })

    const fc = await daemon.getFileChanges("sess_v16")
    expect(fc.files).toEqual([])
  })
})
