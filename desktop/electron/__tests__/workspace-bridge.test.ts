import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  detectLanguageFromPath,
  readWorkspaceFile,
  resolveSafeWorkspacePath,
} from "../workspace-bridge"

describe("workspace-bridge security and language detection", () => {
  it("allows relative and absolute paths inside workspace root", () => {
    const root = "/tmp/rayu-workspace"
    expect(resolveSafeWorkspacePath(root, "src/main.rs")).toBe(
      path.resolve(root, "src/main.rs")
    )
    expect(resolveSafeWorkspacePath(root, "/tmp/rayu-workspace/Cargo.toml")).toBe(
      path.resolve(root, "Cargo.toml")
    )
  })

  it("blocks path traversal escaping workspace root", () => {
    const root = "/tmp/rayu-workspace"
    expect(() => resolveSafeWorkspacePath(root, "../../etc/passwd")).toThrow(
      /escapes active workspace root/i
    )
    expect(() => resolveSafeWorkspacePath(root, "/etc/passwd")).toThrow(
      /escapes active workspace root/i
    )
  })

  it("detects common Shiki languages from file extension", () => {
    expect(detectLanguageFromPath("src/session/lookup.rs")).toBe("rust")
    expect(detectLanguageFromPath("src/App.tsx")).toBe("tsx")
    expect(detectLanguageFromPath("package.json")).toBe("json")
    expect(detectLanguageFromPath("README.md")).toBe("markdown")
    expect(detectLanguageFromPath("unknown.xyz")).toBe("text")
  })

  it("blocks symlinks escaping workspace root, flags binary files, and avoids U+FFFD at UTF-8 boundaries", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-ws-sec-"))
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-ws-out-"))
    try {
      const secretFile = path.join(outsideDir, "secret.txt")
      fs.writeFileSync(secretFile, "top secret", "utf8")
      const linkPath = path.join(tmpRoot, "escape-link.txt")
      fs.symlinkSync(secretFile, linkPath)

      expect(() => resolveSafeWorkspacePath(tmpRoot, "escape-link.txt")).toThrow(
        /escapes active workspace root/i
      )

      const binPath = path.join(tmpRoot, "blob.bin")
      fs.writeFileSync(binPath, Buffer.from([0x48, 0x69, 0x00, 0xff]))
      const binRes = await readWorkspaceFile(tmpRoot, "blob.bin")
      expect(binRes.isBinary).toBe(true)

      // 4-byte emoji (🚀) starts at byte 4 so reading 5 bytes cuts inside the scalar
      const utf8File = path.join(tmpRoot, "emoji.txt")
      fs.writeFileSync(utf8File, "abcd🚀efgh", "utf8")
      const utf8Res = await readWorkspaceFile(tmpRoot, "emoji.txt", 5)
      expect(utf8Res.truncated).toBe(true)
      expect(utf8Res.lines.join("\n")).not.toContain("\uFFFD")
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
      fs.rmSync(outsideDir, { recursive: true, force: true })
    }
  })
})
