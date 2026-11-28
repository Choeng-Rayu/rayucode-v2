/** @vitest-environment node */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { RayuDaemonClient } from "../electron/daemon-client"

const REPO_ROOT = path.resolve(__dirname, "../..")
const SELFDEV_BINARY = path.join(
  REPO_ROOT,
  "target",
  "selfdev",
  process.platform === "win32" ? "rayu.exe" : "rayu"
)

const ENV_KEYS = [
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "RAYU_HOME",
  "RAYU_AUTH_CONFIG_DIR",
  "RAYU_CONFIG_DIR",
  "RAYU_BINARY",
  "RAYU_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "DEEPSEEK_API_KEY",
] as const

describe("Isolated ./target/selfdev/rayu Engine Acceptance", () => {
  const cleanups: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()
      await fn?.()
    }
  })

  it(
    "boots signed-out, keeps 0 sessions across global runtime commands, rejects signed-out turns with auth_required, forwards fork boundary, and shuts down cleanly",
    async () => {
      expect(fs.existsSync(SELFDEV_BINARY)).toBe(true)

      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ra-"))
      const rayuHome = path.join(tmpRoot, ".rayu")
      const workspace = path.join(tmpRoot, "ws")
      fs.mkdirSync(rayuHome, { recursive: true, mode: 0o700 })
      fs.mkdirSync(workspace, { recursive: true })

      const savedEnv = new Map<string, string | undefined>()
      for (const key of ENV_KEYS) {
        savedEnv.set(key, process.env[key])
      }

      process.env.HOME = tmpRoot
      process.env.XDG_CONFIG_HOME = path.join(tmpRoot, ".config")
      process.env.XDG_DATA_HOME = path.join(tmpRoot, ".local", "share")
      process.env.RAYU_HOME = rayuHome
      process.env.RAYU_AUTH_CONFIG_DIR = rayuHome
      process.env.RAYU_CONFIG_DIR = rayuHome
      delete process.env.RAYU_BINARY
      for (const key of [
        "RAYU_API_KEY",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
        "OPENROUTER_API_KEY",
        "GROQ_API_KEY",
        "XAI_API_KEY",
        "DEEPSEEK_API_KEY",
      ]) {
        delete process.env[key]
      }

      const socketPath = path.join(tmpRoot, "accept.sock")
      const client = new RayuDaemonClient({
        socketPath,
        resolveBinary: () => SELFDEV_BINARY,
      })

      cleanups.push(async () => {
        await client.shutdown().catch(() => {})
        for (const [k, v] of savedEnv) {
          if (v === undefined) delete process.env[k]
          else process.env[k] = v
        }
        fs.rmSync(tmpRoot, { recursive: true, force: true })
      })

      // 1. Cold signed-out startup via private instance
      const status = await client.checkConnection(workspace)
      expect(status.connected).toBe(true)
      expect(status.mode).toBe("live")
      expect(client.getStatus().connected).toBe(true)

      // 2. Global runtime commands MUST NOT create phantom sessions
      const tgRes = await client.runGlobalRuntimeCommand(
        "telegram",
        ["status"],
        workspace
      )
      expect(tgRes.command).toBe("telegram")

      const agentsRes = await client.runGlobalRuntimeCommand(
        "agents",
        ["status"],
        workspace
      )
      expect(agentsRes.command).toBe("agents")

      const mcpRes = await client.runGlobalRuntimeCommand(
        "mcp",
        ["list"],
        workspace
      )
      expect(mcpRes.command).toBe("mcp")

      const initialSessions = await client.listSessions()
      expect(initialSessions).toEqual([])

      // 3. Create session -> signed-out turn must fail promptly with typed auth error
      const session = await client.createSession(workspace, "Signed-out check")
      expect(session.session_id).toBeTruthy()

      let sendError: unknown = null
      try {
        await client.sendMessage(session.session_id, "Reply with pong")
      } catch (err) {
        sendError = err
      }
      expect(sendError).toBeTruthy()
      const errCode =
        sendError && typeof sendError === "object" && "code" in sendError
          ? String((sendError as { code?: unknown }).code ?? "")
          : ""
      const errMsg =
        sendError instanceof Error ? sendError.message : String(sendError)
      expect(`${errCode} ${errMsg}`).toMatch(
        /auth_required|not signed in|sign in|api key|credential|provider/i
      )

      const history = await client.getHistory(session.session_id)
      expect(history.messages).toEqual([])

      // 4. Exact fork boundary validation reaches Rust truncate_split_messages + fork works
      await expect(
        client.forkSession(session.session_id, { upToMessageIndex: 999 })
      ).rejects.toThrow(/out of range|not found/i)

      const forked = await client.forkSession(session.session_id)
      expect(forked.session_id).toBeTruthy()
      expect(forked.session_id).not.toBe(session.session_id)

      // 5. Clean owned shutdown
      await client.shutdown()
      expect(client.getStatus().connected).toBe(false)
    },
    60_000
  )
})
