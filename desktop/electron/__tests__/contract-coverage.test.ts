/** @vitest-environment node */

import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const DESKTOP_ROOT = path.resolve(__dirname, "../..")

function extractChannels(source: string, pattern: RegExp): Set<string> {
  const channels = new Set<string>()
  for (const match of source.matchAll(pattern)) {
    const channel = match[1]?.trim()
    if (channel) {
      channels.add(channel)
    }
  }
  return channels
}

describe("Electron Main <-> Preload <-> Matrix contract coverage", () => {
  it("keeps 1:1 IPC channel parity across main.ts, preload.cjs, and DESKTOP_FUNCTION_TEST_MATRIX.md", () => {
    const mainSrc = fs.readFileSync(
      path.join(DESKTOP_ROOT, "electron", "main.ts"),
      "utf8"
    )
    const preloadSrc = fs.readFileSync(
      path.join(DESKTOP_ROOT, "electron", "preload.cjs"),
      "utf8"
    )
    const matrixSrc = fs.readFileSync(
      path.join(DESKTOP_ROOT, "docs", "DESKTOP_FUNCTION_TEST_MATRIX.md"),
      "utf8"
    )

    // Verify handleTrusted delegates to ipcMain.handle (never recursive self-call)
    expect(mainSrc).toMatch(
      /const handleTrusted:\s*typeof ipcMain\.handle\s*=\s*\(channel,\s*listener\)\s*=>\s*ipcMain\.handle\(channel,/
    )

    const mainChannels = extractChannels(
      mainSrc,
      /(?:handleTrusted|ipcMain\.handle)\(\s*["'`](rayu:[^"'`]+)["'`]/g
    )
    const preloadChannels = extractChannels(
      preloadSrc,
      /ipcRenderer\.invoke\(\s*["'`](rayu:[^"'`]+)["'`]/g
    )

    const missingInPreload = [...mainChannels].filter(
      (c) => !preloadChannels.has(c)
    )
    const missingInMain = [...preloadChannels].filter(
      (c) => !mainChannels.has(c)
    )

    expect(missingInPreload).toEqual([])
    expect(missingInMain).toEqual([])
    expect(mainChannels.size).toBe(110)

    const undocumentedChannels = [...mainChannels].filter(
      (channel) => !matrixSrc.includes(`\`${channel}\``)
    )
    expect(undocumentedChannels).toEqual([])
  })

  it("preserves DESIGN.md sidebar width token and removes unused dead shell files", () => {
    const css = fs.readFileSync(
      path.join(DESKTOP_ROOT, "src", "styles", "globals.css"),
      "utf8"
    )
    expect(css).toContain("--sidebar-w: 296px;")

    const shellDir = path.join(DESKTOP_ROOT, "src", "components", "shell")
    expect(fs.existsSync(path.join(shellDir, "daemon-banner.tsx"))).toBe(false)
    expect(fs.existsSync(path.join(shellDir, "dual-mode-top-bar.tsx"))).toBe(
      false
    )
    expect(fs.existsSync(path.join(shellDir, "session-pane.tsx"))).toBe(false)
  })
})
