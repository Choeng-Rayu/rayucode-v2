import path from "node:path"
import { describe, expect, it } from "vitest"

import { TerminalPtyManager } from "../terminal-bridge"

describe("TerminalPtyManager (real interactive OS PTY)", () => {
  it("spawns a real interactive PTY in the active project folder and streams command output", async () => {
    const manager = new TerminalPtyManager()
    const targetDir = path.resolve(process.cwd())
    let buffer = ""

    const created = manager.create({
      sessionId: "test_pty_1",
      cwd: targetDir,
      fallbackCwd: targetDir,
      cols: 80,
      rows: 24,
      onData: (chunk) => {
        buffer += chunk
      },
      onExit: () => {},
    })

    expect(created.ok).toBe(true)
    expect(created.cwd).toBe(targetDir)

    manager.resize("test_pty_1", 100, 30)
    manager.write("test_pty_1", "pwd\r")

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 4500
      const timer = setInterval(() => {
        if (buffer.includes(path.basename(targetDir))) {
          clearInterval(timer)
          resolve()
          return
        }
        if (Date.now() > deadline) {
          clearInterval(timer)
          reject(new Error(`Timed out waiting for PTY pwd output. Got: ${buffer}`))
        }
      }, 50)
    })

    expect(buffer).toContain(path.basename(targetDir))
    expect(manager.kill("test_pty_1").ok).toBe(true)
  })
})
