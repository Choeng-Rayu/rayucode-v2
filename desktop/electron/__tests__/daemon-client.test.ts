import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RayucodeClient } from "@rayu-dev/rayucode-sdk"

import { RayuDaemonClient } from "../daemon-client"

describe("RayuDaemonClient startup coalescing & reconnecting state", () => {
  const originalEnv = { ...process.env }
  let tmpHome: string

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-daemon-test-"))
    process.env.RAYU_HOME = tmpHome
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("coalesces concurrent checkConnection/getOrProbeStatus calls to a single launch without sticking reconnecting=true", async () => {
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
})
