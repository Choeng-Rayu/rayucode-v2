import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createLocalSkill,
  deleteCustomTemplate,
  disposeWorkspaceRegistry,
  ensureRegisteredWorkspace,
  listLocalExtensions,
  listWorkspaceFiles,
  MalformedJsonConfigError,
  migrateLegacyEngineSettingsOnce,
  readCustomTemplates,
  readDesktopPreferences,
  readDesktopSessionStore,
  readRecentWorkspaces,
  readSidebarState,
  recordRecentWorkspace,
  removeLocalMcpServer,
  saveCustomTemplate,
  toggleLocalSkill,
  upsertLocalMcpServer,
  writeDesktopPreferences,
  writeDesktopSessionStore,
  writeSidebarState,
} from "../storage-bridge"

describe("storage-bridge persistence & local workspace scanning", () => {
  const originalEnv = { ...process.env }
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-storage-test-"))
    process.env.RAYU_HOME = path.join(tmpRoot, "rayu-home")
    process.env.XDG_CONFIG_HOME = path.join(tmpRoot, "xdg")
  })

  afterEach(() => {
    disposeWorkspaceRegistry()
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

  it("discovers .rayu/mcp.json and filters out disabled MCP entries", () => {
    const ws = path.join(tmpRoot, "disabled-mcp-project")
    fs.mkdirSync(path.join(ws, ".rayu"), { recursive: true })
    fs.writeFileSync(
      path.join(ws, ".rayu", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          activeSrv: { command: "npx", args: ["-y", "active-mcp"] },
          disabledFlag: { command: "npx", disabled: true },
          enabledFalse: { command: "npx", enabled: false },
        },
      })
    )
    const snapshot = listLocalExtensions(ws)
    expect(snapshot.mcpServers.some((m) => m.id === "activeSrv")).toBe(true)
    expect(snapshot.mcpServers.some((m) => m.id === "disabledFlag")).toBe(false)
    expect(snapshot.mcpServers.some((m) => m.id === "enabledFalse")).toBe(false)
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

  it("migrates legacy desktop workspaces/sidebar into canonical workspaces.json, deduplicates symlinks, and ignores desktop-sessions.json phantoms", async () => {
    const realDir = path.join(tmpRoot, "real-repo")
    const linkDir = path.join(tmpRoot, "symlink-repo")
    fs.mkdirSync(realDir, { recursive: true })
    fs.symlinkSync(realDir, linkDir)

    // Seed legacy desktop-workspaces.json & desktop-sessions.json phantom
    recordRecentWorkspace(realDir)
    writeDesktopSessionStore({
      sessions: [{ id: "phantom_ses_999", title: "Phantom" }],
      turns: [],
    })

    const state = await readSidebarState()
    expect(state.showProjectChatsInRecents).toBe(false)
    expect(state.projects).toHaveLength(1)
    expect(state.projects[0]?.id).toMatch(/^ws_/)

    // Registering symlink to the same directory deduplicates to the exact same canonical workspace ID
    const ensured = await ensureRegisteredWorkspace(linkDir, {
      name: "real-repo",
    })
    expect(ensured.created).toBe(false)
    expect(ensured.id).toBe(state.projects[0]?.id)

    // Writing pinned/archived state syncs atomically to ~/.rayu/workspaces.json
    const saved = await writeSidebarState({
      ...state,
      pinnedChatIds: ["ses_live_1"],
      archivedChatIds: ["ses_old_2"],
    })
    expect(saved.pinnedChatIds).toEqual(["ses_live_1"])
    expect(saved.archivedChatIds).toEqual(["ses_old_2"])

    const workspacesJsonPath = path.join(process.env.RAYU_HOME!, "workspaces.json")
    expect(fs.existsSync(workspacesJsonPath)).toBe(true)
    const rawLedger = JSON.parse(
      fs.readFileSync(workspacesJsonPath, "utf8")
    ) as {
      pinnedSessionIds: string[]
      archivedSessionIds: string[]
      migratedSources: string[]
      workspaces: Array<{ sessionIds: string[] }>
    }
    expect(rawLedger.migratedSources).toContain("desktop-v1")
    expect(rawLedger.pinnedSessionIds).toEqual(["ses_live_1"])
    expect(rawLedger.archivedSessionIds).toEqual(["ses_old_2"])
    expect(
      rawLedger.workspaces.flatMap((w) => w.sessionIds)
    ).not.toContain("phantom_ses_999")
  })

  it("migrates legacy engine settings once into config.toml without overwriting existing overrides", async () => {
    writeDesktopPreferences({
      defaultModel: "claude-opus-4-6",
      defaultPermissionMode: "plan",
      autoCompactContext: false,
      kvCacheTtl: "5m",
    })

    const patchConfig = vi.fn().mockResolvedValue({ ok: true })
    const getConfig = vi.fn().mockResolvedValue({
      values: {
        "provider.default_model": "gpt-5.4",
        "provider.anthropic_cache_ttl_1h": true,
        "compaction.reactive_threshold_tokens": 400_000,
        "safety.default_permission_mode": "default",
      },
      schema: [
        { key: "provider.default_model", default_value: null },
        { key: "provider.anthropic_cache_ttl_1h", default_value: true },
        { key: "compaction.reactive_threshold_tokens", default_value: 400_000 },
        { key: "safety.default_permission_mode", default_value: "default" },
      ],
    })

    const first = await migrateLegacyEngineSettingsOnce({ getConfig, patchConfig })
    expect(first.migrated).toBe(true)
    expect(patchConfig).toHaveBeenCalledTimes(1)
    expect(patchConfig).toHaveBeenCalledWith({
      "provider.anthropic_cache_ttl_1h": false,
      "compaction.reactive_threshold_tokens": 0,
      "safety.default_permission_mode": "plan",
    })
    expect(readDesktopPreferences().engineConfigMigratedV1).toBe(true)

    const second = await migrateLegacyEngineSettingsOnce({ getConfig, patchConfig })
    expect(second).toEqual({ migrated: false, patchedKeys: [] })
    expect(patchConfig).toHaveBeenCalledTimes(1)
  })

  it("defers legacy engine migration when connected to v1.15 daemon (getConfig returns null)", async () => {
    writeDesktopPreferences({ defaultModel: "claude-sonnet-4-6" })
    const patchConfig = vi.fn()
    const res = await migrateLegacyEngineSettingsOnce({
      getConfig: vi.fn().mockResolvedValue(null),
      patchConfig,
    })
    expect(res).toEqual({ migrated: false, patchedKeys: [] })
    expect(patchConfig).not.toHaveBeenCalled()
    expect(readDesktopPreferences().engineConfigMigratedV1).toBeUndefined()
  })

  it("preserves existing headers/timeout/env when patching MCP server, rejects stale revisions, and fails closed on malformed .mcp.json", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-mcp-ws-"))
    try {
      const wsMcp = path.join(ws, ".mcp.json")
      fs.writeFileSync(
        wsMcp,
        JSON.stringify(
          {
            mcpServers: {
              linear: {
                type: "http",
                url: "https://old.example/mcp",
                headers: { Authorization: "Bearer secret-tok" },
                timeout: 12000,
                customFlag: true,
              },
            },
          },
          null,
          2
        )
      )

      const initial = listLocalExtensions(ws)
      const rev = initial.revisions?.[wsMcp]
      expect(rev).toBeTruthy()

      // Editing only URL must preserve headers, timeout, type, customFlag
      const updated = upsertLocalMcpServer(ws, {
        id: "linear",
        scope: "workspace",
        url: "https://new.example/mcp",
        expectedRevision: rev,
      })
      expect(updated.mcpServers.find((s) => s.id === "linear")).toMatchObject({
        url: "https://new.example/mcp",
        timeout: 12000,
        headerKeys: ["Authorization"],
      })
      const diskAfter = JSON.parse(fs.readFileSync(wsMcp, "utf8")) as {
        mcpServers: Record<string, Record<string, unknown>>
      }
      expect(diskAfter.mcpServers.linear.headers).toEqual({
        Authorization: "Bearer secret-tok",
      })
      expect(diskAfter.mcpServers.linear.timeout).toBe(12000)
      expect(diskAfter.mcpServers.linear.customFlag).toBe(true)

      // Stale revision must fail closed
      expect(() =>
        upsertLocalMcpServer(ws, {
          id: "linear",
          scope: "workspace",
          url: "https://stale.example/mcp",
          expectedRevision: rev,
        })
      ).toThrow(/changed on disk|stale revision/i)

      // Malformed .mcp.json must preserve original bytes and surface error
      const malformedBytes = "{ broken json: true,,,"
      fs.writeFileSync(wsMcp, malformedBytes, "utf8")
      const listed = listLocalExtensions(ws)
      expect(listed.mcpConfigErrors?.[0]?.filePath).toBe(wsMcp)
      expect(() =>
        upsertLocalMcpServer(ws, {
          id: "newone",
          scope: "workspace",
          url: "https://ok.example/mcp",
        })
      ).toThrow(MalformedJsonConfigError)
      expect(fs.readFileSync(wsMcp, "utf8")).toBe(malformedBytes)
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
    }
  })
})
