import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  createLocalSkill,
  deleteCustomTemplate,
  listLocalExtensions,
  listWorkspaceFiles,
  readCustomTemplates,
  readDesktopPreferences,
  readDesktopSessionStore,
  readRecentWorkspaces,
  recordRecentWorkspace,
  removeLocalMcpServer,
  saveCustomTemplate,
  toggleLocalSkill,
  upsertLocalMcpServer,
  writeDesktopPreferences,
  writeDesktopSessionStore,
} from "../storage-bridge"

describe("storage-bridge persistence & local workspace scanning", () => {
  const originalEnv = { ...process.env }
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-storage-test-"))
    process.env.RAYU_HOME = path.join(tmpRoot, "rayu-home")
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it("persists and merges desktop preferences across restarts", () => {
    const initial = readDesktopPreferences()
    expect(initial.defaultPermissionMode).toBe("default")
    expect(initial.useAllCredits).toBe(false)

    const updated = writeDesktopPreferences({
      defaultPermissionMode: "plan",
      useAllCredits: true,
      showMiniPet: true,
    })
    expect(updated.defaultPermissionMode).toBe("plan")
    expect(updated.useAllCredits).toBe(true)
    expect(updated.showMiniPet).toBe(true)

    const reloaded = readDesktopPreferences()
    expect(reloaded.defaultPermissionMode).toBe("plan")
    expect(reloaded.useAllCredits).toBe(true)
    expect(reloaded.showMiniPet).toBe(true)
  })

  it("persists sessions/turns and enforces retention caps", () => {
    const sessions = Array.from({ length: 65 }, (_, i) => ({
      id: `ses_${i}`,
      title: `Session ${i}`,
    }))
    const turns = Array.from({ length: 520 }, (_, i) => ({
      id: `turn_${i}`,
      sessionId: "ses_0",
    }))

    writeDesktopSessionStore({ sessions, turns })
    const loaded = readDesktopSessionStore()
    expect(loaded.sessions).toHaveLength(50)
    expect(loaded.turns).toHaveLength(500)
  })

  it("records and deduplicates recent workspaces", () => {
    const wsA = path.join(tmpRoot, "repo-a")
    const wsB = path.join(tmpRoot, "repo-b")
    fs.mkdirSync(wsA, { recursive: true })
    fs.mkdirSync(wsB, { recursive: true })

    recordRecentWorkspace(wsA)
    recordRecentWorkspace(wsB)
    recordRecentWorkspace(wsA)

    const recent = readRecentWorkspaces()
    expect(recent).toHaveLength(2)
    expect(recent[0]?.name).toBe("repo-a")
    expect(recent[1]?.name).toBe("repo-b")
  })

  it("lists workspace source files while skipping ignored directories", () => {
    const ws = path.join(tmpRoot, "sample-project")
    fs.mkdirSync(path.join(ws, "src"), { recursive: true })
    fs.mkdirSync(path.join(ws, "node_modules", "pkg"), { recursive: true })
    fs.mkdirSync(path.join(ws, ".git"), { recursive: true })

    fs.writeFileSync(path.join(ws, "src", "main.ts"), "export const x = 1\n")
    fs.writeFileSync(path.join(ws, "README.md"), "# Hello\n")
    fs.writeFileSync(
      path.join(ws, "node_modules", "pkg", "index.js"),
      "module.exports = {}\n"
    )
    fs.writeFileSync(path.join(ws, ".git", "HEAD"), "ref: refs/heads/main\n")

    const files = listWorkspaceFiles(ws)
    const paths = files.map((f) => f.path)
    expect(paths).toContain("README.md")
    expect(paths).toContain("src/main.ts")
    expect(paths.some((p) => p.includes("node_modules"))).toBe(false)
    expect(paths.some((p) => p.includes(".git"))).toBe(false)
  })

  it("scans real local MCP config, SKILL.md frontmatter, and memory files", () => {
    const ws = path.join(tmpRoot, "ext-project")
    fs.mkdirSync(path.join(ws, ".agents", "skills", "custom-skill"), {
      recursive: true,
    })

    fs.writeFileSync(
      path.join(ws, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          context7: { command: "npx -y @upstash/context7-mcp" },
        },
      })
    )
    fs.writeFileSync(
      path.join(ws, ".agents", "skills", "custom-skill", "SKILL.md"),
      "---\nname: my-custom-skill\ndescription: Helps verify RayuCode Desktop\n---\n# Details\n"
    )
    fs.writeFileSync(
      path.join(ws, "CLAUDE.md"),
      "# Project Rules\nAlways run full verification before reporting completion.\n"
    )

    const snapshot = listLocalExtensions(ws)
    expect(snapshot.mcpServers.some((m) => m.id === "context7")).toBe(true)
    expect(
      snapshot.skills.find((s) => s.name === "my-custom-skill")
    ).toMatchObject({
      name: "my-custom-skill",
      scope: "Workspace",
      description: "Helps verify RayuCode Desktop",
    })
    expect(snapshot.memories.some((m) => m.path === "CLAUDE.md")).toBe(true)
  })

  it("writes, updates, and removes real MCP servers in mcp.json and creates/toggles skills on disk", () => {
    const ws = path.join(tmpRoot, "mcp-write-project")
    fs.mkdirSync(ws, { recursive: true })

    const afterInstall = upsertLocalMcpServer(ws, {
      id: "context7",
      scope: "global",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
    })
    expect(afterInstall.mcpServers.find((m) => m.id === "context7")).toMatchObject({
      id: "context7",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      installed: true,
    })

    const afterRemove = removeLocalMcpServer(ws, "context7", "global")
    expect(afterRemove.mcpServers.some((m) => m.id === "context7")).toBe(false)

    const afterSkill = createLocalSkill(ws, {
      name: "Release Gate",
      description: "Verifies build before shipping",
    })
    const created = afterSkill.skills.find((s) => s.name === "Release Gate")
    expect(created).toBeDefined()
    expect(created?.enabled).toBe(true)

    const afterToggle = toggleLocalSkill(ws, created!.id)
    expect(
      afterToggle.skills.find((s) => s.id === created!.id)?.enabled
    ).toBe(false)
  })

  it("saves, lists, and deletes custom reusable composer templates on disk", () => {
    expect(readCustomTemplates()).toEqual([])

    const afterSave = saveCustomTemplate({
      kind: "presentation",
      name: "Quarterly Board Update",
      description: "Executive KPIs and product milestones",
      promptSpec: "Build a 10-slide board update deck with ARR and roadmap.",
      accent: "navy",
    })
    expect(afterSave).toHaveLength(1)
    expect(afterSave[0]).toMatchObject({
      kind: "presentation",
      name: "Quarterly Board Update",
      accent: "navy",
    })

    const reloaded = readCustomTemplates()
    expect(reloaded).toHaveLength(1)

    const afterDelete = deleteCustomTemplate(afterSave[0]!.id)
    expect(afterDelete).toHaveLength(0)
  })
})
