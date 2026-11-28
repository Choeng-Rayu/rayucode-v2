import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
    openPath: vi.fn().mockResolvedValue(""),
    showItemInFolder: vi.fn(),
  },
}))

import {
  assertTrustedSender,
  isAllowedWebviewUrl,
  isTrustedRendererUrl,
} from "../ipc-security"
import { openExternal, openInExcel } from "../native-bridge"

describe("Electron IPC origin security & native-bridge guards", () => {
  it("allows only matching dev origin or dist/ file URLs in assertTrustedSender", () => {
    const distDir = "/app/desktop/dist"
    const indexFileUrl = pathToFileURL(path.join(distDir, "index.html")).toString()

    expect(
      isTrustedRendererUrl("http://localhost:5173/index.html", {
        devServerUrl: "http://localhost:5173",
        distDir,
      })
    ).toBe(true)

    expect(
      isTrustedRendererUrl(indexFileUrl, {
        distDir,
      })
    ).toBe(true)

    expect(() =>
      assertTrustedSender(
        { senderFrame: { url: "https://evil.example/phish.html" } },
        { devServerUrl: "http://localhost:5173", distDir }
      )
    ).toThrow(/untrusted renderer frame/i)

    expect(() =>
      assertTrustedSender(
        { senderFrame: { url: "file:///etc/passwd" } },
        { distDir }
      )
    ).toThrow(/untrusted renderer frame/i)

    expect(() =>
      assertTrustedSender({ senderFrame: { url: "" } }, { distDir })
    ).toThrow(/untrusted renderer frame/i)
  })

  it("restricts webview navigation URLs and native.openExternal to safe HTTP(S) schemes", async () => {
    expect(isAllowedWebviewUrl("http://localhost:3000")).toBe(true)
    expect(isAllowedWebviewUrl("https://rayucode.com/docs")).toBe(true)
    expect(isAllowedWebviewUrl("about:blank")).toBe(true)
    expect(isAllowedWebviewUrl("file:///etc/passwd")).toBe(false)
    expect(isAllowedWebviewUrl("javascript:alert(1)")).toBe(false)

    expect(await openExternal("file:///etc/passwd")).toEqual({ ok: false })
    expect(await openExternal("javascript:alert(1)")).toEqual({ ok: false })
    expect(await openExternal("https://rayucode.com")).toEqual({ ok: true })
  })

  it("fails closed in openInExcel instead of synthesizing demo .xlsx workbooks", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-native-test-"))
    const missing = path.join(tmpDir, "nonexistent-sheet.xlsx")
    expect(await openInExcel(missing, tmpDir)).toMatchObject({ ok: false })
    expect(fs.existsSync(missing)).toBe(false)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("delegates handleTrusted in electron/main.ts to ipcMain.handle instead of calling itself recursively", () => {
    const mainSrc = fs.readFileSync(
      path.resolve(__dirname, "../main.ts"),
      "utf8"
    )
    expect(mainSrc).toMatch(
      /const handleTrusted:\s*typeof ipcMain\.handle\s*=\s*\(channel,\s*listener\)\s*=>\s*ipcMain\.handle\(channel,/
    )
  })
})
