import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildCliLoginUrl,
  getRayuAppConfigDir,
  isSafeRayuBaseUrl,
  parseAnthropicSseChunk,
  parseCallbackUrl,
  RayuAuthManager,
} from "../auth-bridge"

describe("auth-bridge helpers", () => {
  it("validates Rayu base URLs safely", () => {
    expect(isSafeRayuBaseUrl("https://api.rayucode.com/api")).toBe(true)
    expect(isSafeRayuBaseUrl("https://gateway.rayucode.com")).toBe(true)
    expect(isSafeRayuBaseUrl("http://127.0.0.1:4000")).toBe(true)
    expect(isSafeRayuBaseUrl("http://localhost:8787")).toBe(true)
    expect(isSafeRayuBaseUrl("http://[::1]:8080")).toBe(true)

    expect(isSafeRayuBaseUrl("http://api.rayucode.com")).toBe(false)
    expect(isSafeRayuBaseUrl("https://user:pass@api.rayucode.com")).toBe(false)
    expect(isSafeRayuBaseUrl("javascript:alert(1)")).toBe(false)
    expect(isSafeRayuBaseUrl("not-a-url")).toBe(false)
  })

  it("builds CLI login URLs with port and state query params", () => {
    const url = buildCliLoginUrl("https://rayucode.com/", 54321, "deadbeef")
    expect(url).toBe("https://rayucode.com/cli-login?port=54321&state=deadbeef")
  })

  it("parses full and relative OAuth callback URLs", () => {
    expect(
      parseCallbackUrl("http://127.0.0.1:54321/callback?code=abc123&state=xyz")
    ).toEqual({ code: "abc123", state: "xyz" })

    expect(parseCallbackUrl("/callback?code=c1&state=s1")).toEqual({
      code: "c1",
      state: "s1",
    })

    expect(() => parseCallbackUrl("/callback?state=only")).toThrow(
      /authorization code/i
    )
    expect(() => parseCallbackUrl("/callback?code=only")).toThrow(
      /state parameter/i
    )
  })

  it("parses Anthropic SSE data frames and ignores comments and [DONE]", () => {
    const block = [
      "event: content_block_delta",
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
      "",
      'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"step 1"}}',
      'data: {"type":"message_delta","usage":{"input_tokens":120,"output_tokens":45,"cache_read_input_tokens":90}}',
      "data: [DONE]",
    ].join("\r\n")

    const events = parseAnthropicSseChunk(block)
    expect(events).toHaveLength(3)
    expect(events[0]).toMatchObject({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello" },
    })
    expect(events[1]).toMatchObject({
      type: "content_block_delta",
      delta: { type: "thinking_delta", thinking: "step 1" },
    })
    expect(events[2]).toMatchObject({
      type: "message_delta",
      usage: { input_tokens: 120, output_tokens: 45, cache_read_input_tokens: 90 },
    })
  })
})

describe("auth-bridge Wave 1 guarantees", () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it("resolves platform app config directory aligned with Rust rayucode-storage", () => {
    delete process.env.RAYU_HOME
    delete process.env.RAYU_CONFIG_DIR
    const dir = getRayuAppConfigDir()
    if (process.platform === "darwin") {
      expect(dir).toBe(
        path.join(os.homedir(), "Library", "Application Support", "rayucode")
      )
    } else if (process.platform === "win32") {
      expect(dir.toLowerCase()).toMatch(/rayucode$/)
    } else {
      expect(dir).toMatch(/rayucode$/)
    }

    const customHome = path.join(os.tmpdir(), "rayu-custom-home-test")
    process.env.RAYU_HOME = customHome
    expect(getRayuAppConfigDir()).toBe(
      path.join(customHome, "config", "rayucode")
    )
  })

  it("emits turn_stopped ONCE without a trailing turn_done on SSE error frame", async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-auth-sse-"))
    process.env.RAYU_HOME = tmpHome
    const appDir = getRayuAppConfigDir()
    fs.mkdirSync(appDir, { recursive: true })
    fs.writeFileSync(
      path.join(appDir, "rayu.env"),
      "RAYU_API_KEY=rayu_sk_live_testkey1234567890\n",
      { mode: 0o600 }
    )

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}\n\n'
          )
        )
        controller.enqueue(
          encoder.encode(
            'data: {"type":"error","error":{"message":"rate_limit_exceeded"}}\n\n'
          )
        )
        controller.close()
      },
    })

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: stream,
      })
    )

    const manager = new RayuAuthManager()
    const emitted: Array<{ ev: string; reason?: string; message?: string }> = []
    await manager.streamCloudChat({
      sessionId: "ses_sse_err",
      messages: [{ role: "user", content: "hello" }],
      model: "claude-sonnet-4-6",
      onEvent: (ev) => emitted.push(ev),
    })

    const terminalEvents = emitted.filter(
      (e) => e.ev === "turn_done" || e.ev === "turn_stopped"
    )
    expect(terminalEvents).toHaveLength(1)
    expect(terminalEvents[0]?.ev).toBe("turn_stopped")
    expect(terminalEvents[0]?.message).toContain("rate_limit_exceeded")

    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("emits clean cancelled turn_stopped when user cancels stream", async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-auth-abort-"))
    process.env.RAYU_HOME = tmpHome
    const appDir = getRayuAppConfigDir()
    fs.mkdirSync(appDir, { recursive: true })
    fs.writeFileSync(
      path.join(appDir, "rayu.env"),
      "RAYU_API_KEY=rayu_sk_live_testkey1234567890\n",
      { mode: 0o600 }
    )

    const manager = new RayuAuthManager()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
          })
          queueMicrotask(() => manager.cancelStream("ses_abort"))
        })
      })
    )

    const emitted: Array<{ ev: string; reason?: string }> = []
    await manager.streamCloudChat({
      sessionId: "ses_abort",
      messages: [{ role: "user", content: "cancel me" }],
      model: "claude-sonnet-4-6",
      onEvent: (ev) => emitted.push(ev),
    })

    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      ev: "turn_stopped",
      reason: "cancelled",
    })

    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("executes real local workspace tools in a multi-turn agentic loop when workspaceDir is provided", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-agent-loop-"))
    const tmpHome = path.join(tmpRoot, "home")
    const tmpWs = path.join(tmpRoot, "workspace")
    process.env.RAYU_HOME = tmpHome
    const appDir = getRayuAppConfigDir()
    fs.mkdirSync(appDir, { recursive: true })
    fs.mkdirSync(tmpWs, { recursive: true })
    fs.writeFileSync(
      path.join(appDir, "rayu.env"),
      "RAYU_API_KEY=rayu_sk_live_testkey1234567890\n",
      { mode: 0o600 }
    )
    fs.writeFileSync(
      path.join(tmpWs, "README.md"),
      "# RayuCode Desktop\nLocal-first autonomous coding studio.\n"
    )

    const encoder = new TextEncoder()
    let callCount = 0
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: { body?: string }) => {
      callCount += 1
      if (callCount === 1) {
        const parsedBody = JSON.parse(String(init?.body ?? "{}")) as {
          tools?: Array<{ name: string }>
        }
        expect(parsedBody.tools?.some((t) => t.name === "read_file")).toBe(true)

        const round1 = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
                  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I will read README.md first."}}\n\n' +
                  'data: {"type":"content_block_stop","index":0}\n\n' +
                  'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file","input":{}}}\n\n' +
                  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"README.md\\"}"}}\n\n' +
                  'data: {"type":"content_block_stop","index":1}\n\n'
              )
            )
            controller.close()
          },
        })
        return { ok: true, status: 200, body: round1 }
      }

      // Second round must receive the real file contents in tool_result
      const bodyStr = String(init?.body ?? "")
      expect(bodyStr).toContain("Local-first autonomous coding studio.")

      const round2 = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"RayuCode Desktop is a local-first autonomous coding studio."}}\n\n'
            )
          )
          controller.close()
        },
      })
      return { ok: true, status: 200, body: round2 }
    })

    vi.stubGlobal("fetch", fetchMock)

    const manager = new RayuAuthManager()
    const emitted: Array<{ ev: string; name?: string; tool_output?: string; text?: string }> = []
    await manager.streamCloudChat({
      sessionId: "ses_tools",
      messages: [{ role: "user", content: "Tell me about RayuCode Desktop" }],
      model: "claude-sonnet-4-6",
      workspaceDir: tmpWs,
      onEvent: (ev) => emitted.push(ev),
    })

    expect(callCount).toBe(2)
    expect(emitted.some((e) => e.ev === "promote_answer_to_note")).toBe(true)
    expect(emitted.some((e) => e.ev === "tool_start" && e.name === "read_file")).toBe(true)
    expect(
      emitted.some(
        (e) =>
          e.ev === "tool_done" &&
          e.name === "read_file" &&
          e.tool_output?.includes("Local-first autonomous coding studio.")
      )
    ).toBe(true)
    expect(emitted.some((e) => e.ev === "turn_done")).toBe(true)

    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it("delegates create_powerpoint in Cloud fallback to desktop-tools and emits slide artifact", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-cloud-pptx-"))
    const tmpHome = path.join(tmpRoot, "home")
    const tmpWs = path.join(tmpRoot, "workspace")
    process.env.RAYU_HOME = tmpHome
    const appDir = getRayuAppConfigDir()
    fs.mkdirSync(appDir, { recursive: true })
    fs.mkdirSync(tmpWs, { recursive: true })
    fs.writeFileSync(
      path.join(appDir, "rayu.env"),
      "RAYU_API_KEY=rayu_sk_live_testkey1234567890\n",
      { mode: 0o600 }
    )

    const encoder = new TextEncoder()
    let callCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: { body?: string }) => {
        callCount += 1
        if (callCount === 1) {
          const parsedBody = JSON.parse(String(init?.body ?? "{}")) as {
            tools?: Array<{ name: string }>
          }
          expect(parsedBody.tools?.some((t) => t.name === "create_powerpoint")).toBe(true)
          expect(parsedBody.tools?.some((t) => t.name === "list_templates")).toBe(true)
          const toolArgs = JSON.stringify({
            title: "Cloud Fallback Deck",
            file_path: "cloud-deck.pptx",
            slides: [{ title: "Cover", body: "Generated via shared desktop-tools" }],
          })
          const round1 = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_pptx","name":"create_powerpoint","input":{}}}\n\n' +
                    `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":${JSON.stringify(toolArgs)}}}\n\n` +
                    'data: {"type":"content_block_stop","index":0}\n\n'
                )
              )
              controller.close()
            },
          })
          return { ok: true, status: 200, body: round1 }
        }

        const round2 = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Deck created."}}\n\n'
              )
            )
            controller.close()
          },
        })
        return { ok: true, status: 200, body: round2 }
      })
    )

    const manager = new RayuAuthManager()
    const artifacts: Array<{ kind: string; title?: string; filePath?: string }> = []
    await manager.streamCloudChat({
      sessionId: "ses_cloud_pptx",
      messages: [{ role: "user", content: "Create a deck" }],
      model: "claude-sonnet-4-6",
      workspaceDir: tmpWs,
      onArtifact: (artifact) => artifacts.push(artifact),
      onEvent: () => {},
    })

    expect(fs.existsSync(path.join(tmpWs, "cloud-deck.pptx"))).toBe(true)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({
      kind: "slide",
      title: "Cloud Fallback Deck",
      filePath: path.join(tmpWs, "cloud-deck.pptx"),
    })

    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it("forwards thinking/output_config for adaptive and none reasoningEffort and skips when supportsReasoning is false", async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-auth-effort-"))
    process.env.RAYU_HOME = tmpHome
    const appDir = getRayuAppConfigDir()
    fs.mkdirSync(appDir, { recursive: true })
    fs.writeFileSync(
      path.join(appDir, "rayu.env"),
      "RAYU_API_KEY=rayu_sk_live_testkey1234567890\n",
      { mode: 0o600 }
    )

    const encoder = new TextEncoder()
    const makeEmptyStream = () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n'
            )
          )
          controller.close()
        },
      })

    const capturedPayloads: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init?: { body?: string }) => {
        if (String(url).includes("/models")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              hostedModels: [
                {
                  code: "claude-opus-4-7",
                  label: "Claude Opus 4.7",
                  supports_reasoning: true,
                  supported_efforts: ["none", "low", "medium", "high", "xhigh", "max"],
                  default_effort: "medium",
                },
                {
                  code: "claude-haiku-4-5",
                  label: "Claude Haiku 4.5",
                  supports_reasoning: false,
                  supported_efforts: [],
                },
              ],
            }),
          }
        }
        if (String(url).includes("/anthropic/v1/messages")) {
          capturedPayloads.push(
            JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
          )
          return { ok: true, status: 200, body: makeEmptyStream() }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        }
      })
    )

    const manager = new RayuAuthManager()
    const authState = await manager.refreshAccountDetails()
    expect(authState.allowedModels).toEqual([
      expect.objectContaining({
        code: "claude-opus-4-7",
        supportsReasoning: true,
        supportedEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
        defaultEffort: "medium",
      }),
      expect.objectContaining({
        code: "claude-haiku-4-5",
        supportsReasoning: false,
        supportedEfforts: [],
      }),
    ])

    // 1. Adaptive model + xhigh effort
    await manager.streamCloudChat({
      sessionId: "ses_eff_adaptive",
      model: "claude-opus-4-7",
      reasoningEffort: "xhigh",
      messages: [{ role: "user", content: "Think deeply" }],
      onEvent: () => {},
    })
    expect(capturedPayloads[0]).toMatchObject({
      model: "claude-opus-4-7",
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "xhigh" },
    })

    // 2. Explicit "none" effort -> thinking disabled, no output_config
    await manager.streamCloudChat({
      sessionId: "ses_eff_none",
      model: "claude-opus-4-7",
      reasoningEffort: "none",
      messages: [{ role: "user", content: "Direct answer" }],
      onEvent: () => {},
    })
    expect(capturedPayloads[1]?.thinking).toEqual({ type: "disabled" })
    expect(capturedPayloads[1]?.output_config).toBeUndefined()

    // 3. Model with supportsReasoning === false -> neither thinking nor output_config
    await manager.streamCloudChat({
      sessionId: "ses_eff_unsupported",
      model: "claude-haiku-4-5",
      reasoningEffort: "high",
      messages: [{ role: "user", content: "Fast reply" }],
      onEvent: () => {},
    })
    expect(capturedPayloads[2]?.thinking).toBeUndefined()
    expect(capturedPayloads[2]?.output_config).toBeUndefined()

    fs.rmSync(tmpHome, { recursive: true, force: true })
  })
})
