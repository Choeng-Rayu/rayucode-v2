import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  detectLanguageFromPath,
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
})
