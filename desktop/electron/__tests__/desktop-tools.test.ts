import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockWebContents = vi.hoisted(() => ({
  getAllWebContents: vi.fn<() => unknown[]>(() => []),
}))

vi.mock("electron", () => ({
  webContents: mockWebContents,
}))

import { RayucodeClient, type Transport } from "@rayu-dev/rayucode-sdk"

import { BrowserCdpController } from "../browser-cdp"
import {
  buildDesktopSdkTools,
  DESKTOP_TOOL_DEFINITIONS,
  executeDesktopTool,
  type DesktopArtifactEvent,
} from "../desktop-tools"

describe("desktop-tools unified SdkTool registry", () => {
  const originalEnv = { ...process.env }
  const tempDirs: string[] = []

  beforeEach(() => {
    mockWebContents.getAllWebContents.mockReset()
    mockWebContents.getAllWebContents.mockReturnValue([])
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    vi.restoreAllMocks()
  })

  it("exposes all 9 Desktop tools with valid object JSON schemas", () => {
    const names = DESKTOP_TOOL_DEFINITIONS.map((d) => d.name)
    expect(names).toEqual([
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
    for (const def of DESKTOP_TOOL_DEFINITIONS) {
      expect(def.parameters.type).toBe("object")
    }
  })

  it("compiles all 9 tools through RayucodeClient.configureTools AJV validation and handles live tool_call dispatch", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-sdk-dispatch-"))
    tempDirs.push(dir)

    let onDataCb: ((chunk: Buffer | string) => void) | null = null
    const sentFrames: Array<Record<string, unknown>> = []
    const transport: Transport = {
      write(data: string) {
        for (const line of data.split("\n")) {
          const trimmed = line.trim()
          if (!trimmed) continue
          const frame = JSON.parse(trimmed) as Record<string, unknown>
          sentFrames.push(frame)
          if (frame.req === "hello") {
            queueMicrotask(() =>
              onDataCb?.(
                `${JSON.stringify({
                  v: 1,
                  reply_to: frame.id,
                  ev: "hello_ok",
                  version: 1,
                  server: "test-harness",
                  capabilities: ["session_tools", "permissions", "permission_modes"],
                })}\n`
              )
            )
          } else if (frame.req === "configure_tools" || frame.req === "tool_result") {
            queueMicrotask(() =>
              onDataCb?.(
                `${JSON.stringify({ v: 1, reply_to: frame.id, ev: "ok" })}\n`
              )
            )
          }
        }
      },
      onData(listener) {
        onDataCb = listener
      },
      onClose() {},
      close() {},
    }

    const artifacts: DesktopArtifactEvent[] = []
    const client = await RayucodeClient.connect({ transport })
    await client.configureTools("sess_sdk", {
      custom: buildDesktopSdkTools({
        getWorkspaceDir: () => dir,
        onArtifact: (ev) => artifacts.push(ev),
      }),
    })

    // Simulate daemon sending a tool_call with array-style headers/rows
    onDataCb?.(
      `${JSON.stringify({
        v: 1,
        ev: "tool_call",
        session_id: "sess_sdk",
        call_id: "call_excel_1",
        name: "write_excel",
        input: {
          file_path: "sdk-test.xlsx",
          sheets: [
            {
              name: "Metrics",
              headers: ["KPI", "Value"],
              rows: [["Cache Hit", 94]],
            },
          ],
        },
      })}\n`
    )

    await vi.waitFor(() => {
      const resultFrame = sentFrames.find((f) => f.req === "tool_result")
      expect(resultFrame).toBeDefined()
      expect(resultFrame?.error).toBeUndefined()
      expect(String(resultFrame?.output)).toContain("Saved real Excel workbook")
    })
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.kind).toBe("excel")
    await client.close()
  })

  it("executes create_powerpoint, writes real .pptx, and emits slide artifact event", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-tools-"))
    tempDirs.push(dir)
    const artifacts: DesktopArtifactEvent[] = []
    const tools = buildDesktopSdkTools({
      getWorkspaceDir: () => dir,
      onArtifact: (ev) => artifacts.push(ev),
    })

    const pptxTool = tools.find((t) => t.name === "create_powerpoint")
    expect(pptxTool).toBeDefined()

    const result = await pptxTool!.execute(
      {
        title: "Architecture Overview",
        file_path: "arch.pptx",
        slides: [
          {
            kicker: "Cover",
            title: "Architecture Overview",
            body: "Real slides generated from workspace.",
            layout: "cover",
          },
          {
            title: "Performance",
            body: "Measured benchmarks.",
            bullets: ["Zero hardcoded decks", "Live UI hydration"],
          },
        ],
      },
      { sessionId: "sess_1", callId: "c1", signal: new AbortController().signal }
    )

    expect(typeof result === "object" && !result.error).toBe(true)
    const expectedPath = path.join(dir, "arch.pptx")
    expect(fs.existsSync(expectedPath)).toBe(true)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({
      kind: "slide",
      sessionId: "sess_1",
      title: "Architecture Overview",
      filePath: expectedPath,
    })
    if (artifacts[0]?.kind === "slide") {
      expect(artifacts[0].slides).toHaveLength(2)
    }
  })

  it("executes write_excel with array-style headers/rows, writes real .xlsx, emits excel artifact, and reads it back via read_excel", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-tools-"))
    tempDirs.push(dir)
    const artifacts: DesktopArtifactEvent[] = []
    const tools = buildDesktopSdkTools({
      getWorkspaceDir: () => dir,
      onArtifact: (ev) => artifacts.push(ev),
    })

    const excelTool = tools.find((t) => t.name === "write_excel")
    const readTool = tools.find((t) => t.name === "read_excel")
    expect(excelTool).toBeDefined()
    expect(readTool).toBeDefined()

    const result = await excelTool!.execute(
      {
        file_path: "metrics.xlsx",
        sheets: [
          {
            name: "Summary",
            headers: ["Metric", "Value"],
            rows: [
              ["Latency", 144],
              ["Throughput", 950],
            ],
          },
        ],
      },
      { sessionId: "sess_2", callId: "c2", signal: new AbortController().signal }
    )

    expect(typeof result === "object" && !result.error).toBe(true)
    const outPath = path.join(dir, "metrics.xlsx")
    expect(fs.existsSync(outPath)).toBe(true)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.kind).toBe("excel")
    if (artifacts[0]?.kind === "excel") {
      expect(artifacts[0].sessionId).toBe("sess_2")
      expect(artifacts[0].workbook.fileName).toBe("metrics.xlsx")
      expect(artifacts[0].workbook.sheets[0].headers).toEqual({
        A: "Metric",
        B: "Value",
      })
      expect(artifacts[0].workbook.sheets[0].rows).toHaveLength(2)
    }

    const readResult = await readTool!.execute(
      { path: "metrics.xlsx" },
      { sessionId: "sess_2", callId: "c3", signal: new AbortController().signal }
    )
    expect(typeof readResult === "object" && !readResult.error).toBe(true)
    if (typeof readResult === "object") {
      expect(readResult.output).toContain("Summary")
      expect(readResult.output).toContain("Latency")
    }
  })

  it("saves and lists custom templates via save_template and list_templates", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-tpl-"))
    tempDirs.push(dir)
    process.env.RAYU_HOME = dir

    const deps = { getWorkspaceDir: () => dir }
    const saved = await executeDesktopTool(
      deps,
      "save_template",
      {
        kind: "presentation",
        name: "Board Deck",
        description: "Quarterly board review",
        prompt_spec: "Cover, KPI scorecard, Roadmap, Risks",
        accent: "navy",
      },
      "sess_tpl"
    )
    expect(saved?.error).toBeUndefined()
    expect(saved?.output).toContain("Board Deck")

    const listed = await executeDesktopTool(
      deps,
      "list_templates",
      { kind: "presentation" },
      "sess_tpl"
    )
    expect(listed?.error).toBeUndefined()
    expect(listed?.output).toContain("Board Deck")
    expect(listed?.output).toContain("KPI scorecard")

    const otherKind = await executeDesktopTool(
      deps,
      "list_templates",
      { kind: "spreadsheet" },
      "sess_tpl"
    )
    expect(otherKind?.output).toContain("No saved spreadsheet templates")
  })

  it("returns null from executeDesktopTool for non-desktop tools", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-null-"))
    tempDirs.push(dir)
    const res = await executeDesktopTool(
      { getWorkspaceDir: () => dir },
      "read_file",
      { path: "README.md" }
    )
    expect(res).toBeNull()
  })

  it("auto-opens the right-side browser webview via ensureBrowserOpen and polls until mounted", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-cdp-"))
    tempDirs.push(dir)

    const cdp = new BrowserCdpController({
      ensureOpenTimeoutMs: 500,
      pollIntervalMs: 15,
    })

    let mountedWebview: {
      isDestroyed: () => boolean
      getType: () => string
      loadURL: ReturnType<typeof vi.fn>
      getURL: () => string
      getTitle: () => string
    } | null = null

    mockWebContents.getAllWebContents.mockImplementation(() =>
      mountedWebview ? [mountedWebview] : []
    )

    const ensureOpen = vi.fn(async () => {
      setTimeout(() => {
        mountedWebview = {
          isDestroyed: () => false,
          getType: () => "webview",
          loadURL: vi.fn().mockResolvedValue(undefined),
          getURL: () => "https://rayucode.com/",
          getTitle: () => "RayuCode",
        }
      }, 30)
    })
    cdp.setEnsureBrowserOpen(ensureOpen)

    const tools = buildDesktopSdkTools({
      getWorkspaceDir: () => dir,
      browserCdp: cdp,
    })
    const navTool = tools.find((t) => t.name === "browser_navigate")!
    const res = await navTool.execute(
      { url: "rayucode.com" },
      { sessionId: "sess_b", callId: "cb1", signal: new AbortController().signal }
    )

    expect(ensureOpen).toHaveBeenCalledWith("https://rayucode.com")
    expect(typeof res === "object" && !res.error).toBe(true)
    if (typeof res === "object") {
      expect(res.output).toContain("https://rayucode.com/")
      expect(res.output).toContain("RayuCode")
    }
    expect(mountedWebview!.loadURL).toHaveBeenCalledWith("https://rayucode.com")
  })

  it("returns actionable error when browser webview never mounts within timeout", async () => {
    const cdp = new BrowserCdpController({
      ensureOpenTimeoutMs: 60,
      pollIntervalMs: 15,
    })
    const ensureOpen = vi.fn().mockResolvedValue(undefined)
    cdp.setEnsureBrowserOpen(ensureOpen)

    const res = await cdp.navigate("https://example.com")
    expect(ensureOpen).toHaveBeenCalledWith("https://example.com")
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/No active embedded browser tab/i)
  })

  it("extracts '=' formulas from cell objects, respects AbortSignal, and uses per-session workspace dir", async () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-dt-a-"))
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-dt-b-"))
    tempDirs.push(dirA, dirB)

    const tools = buildDesktopSdkTools({
      getWorkspaceDir: () => dirA,
      getWorkspaceDirForSession: (sid) => (sid === "sess_b" ? dirB : dirA),
    })
    const writeExcel = tools.find((t) => t.name === "write_excel")!

    // Aborted signal short-circuits
    const ac = new AbortController()
    ac.abort()
    const abortedRes = await writeExcel.execute(
      { file_path: "aborted.xlsx", sheets: [] },
      { sessionId: "sess_b", callId: "c_abort", signal: ac.signal }
    )
    expect(typeof abortedRes === "object" && abortedRes.error).toMatch(/aborted/i)

    // Formula inside rowObj.cells + routed to session B workspace
    const okRes = await writeExcel.execute(
      {
        file_path: "calc.xlsx",
        sheets: [
          {
            name: "Calc",
            headers: { A: "X", B: "Sum" },
            rows: [
              { rowNumber: 2, cells: { A: 5, B: "=SUM(A2)" } },
            ],
          },
        ],
      },
      { sessionId: "sess_b", callId: "c_ok", signal: new AbortController().signal }
    )
    expect(typeof okRes === "object" && !okRes.error).toBe(true)
    expect(fs.existsSync(path.join(dirB, "calc.xlsx"))).toBe(true)
    expect(fs.existsSync(path.join(dirA, "calc.xlsx"))).toBe(false)
  })
})
