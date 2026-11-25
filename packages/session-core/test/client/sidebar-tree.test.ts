import { describe, expect, it } from "vitest";

import {
  createOrReuseDraft,
  deriveSidebarTree,
  formatDaemonVersionLabel,
  formatSessionSourceLabel,
  normalizeSessionSource,
  sessionSourceToFilterGroup,
  type SidebarSessionLike,
  type SidebarWorkspaceLike,
} from "../../src/client/sidebar-tree.js";

describe("deriveSidebarTree", () => {
  const workspaces: SidebarWorkspaceLike[] = [
    {
      id: "ws-a",
      name: "rayucode-v2",
      path: "/Users/dev/rayucode-v2",
      canonicalPath: "/Users/dev/rayucode-v2",
      sessionIds: ["s-explicit"],
      lastOpenedAt: 200,
    },
    {
      id: "ws-b",
      name: "other-repo",
      path: "/Users/dev/other-repo",
      canonicalPath: "/Users/dev/other-repo",
      sessionIds: [],
      lastOpenedAt: 100,
    },
  ];

  const sessions: SidebarSessionLike[] = [
    {
      id: "s-explicit",
      title: "Explicit session",
      workingDir: "/Users/dev/rayucode-v2",
      updatedAtMs: 500,
    },
    {
      id: "s-path-match",
      title: "Path matched session",
      workingDir: "/Users/dev/other-repo/",
      updatedAtMs: 400,
    },
    {
      id: "s-no-dir",
      title: "Session with empty workingDir",
      workingDir: "",
      updatedAtMs: 300,
    },
    {
      id: "s-archived",
      title: "Archived chat",
      workingDir: "/Users/dev/rayucode-v2",
      updatedAtMs: 600,
    },
  ];

  it("assigns every active session to at most one workspace and never matches empty workingDir", () => {
    const tree = deriveSidebarTree({
      sessions,
      workspaces,
      archivedSessionIds: ["s-archived"],
    });

    const wsA = tree.groups.find((g) => g.workspace.id === "ws-a")!;
    const wsB = tree.groups.find((g) => g.workspace.id === "ws-b")!;

    expect(wsA.sessions.map((s) => s.id)).toEqual(["s-explicit"]);
    expect(wsB.sessions.map((s) => s.id)).toEqual(["s-path-match"]);
    expect(tree.ungrouped.map((s) => s.id)).toEqual(["s-no-dir"]);
    expect(tree.archived.map((s) => s.id)).toEqual(["s-archived"]);

    // Verify strict disjointness across groups + ungrouped
    const allGroupedIds = [
      ...tree.groups.flatMap((g) => g.sessions.map((s) => s.id)),
      ...tree.ungrouped.map((s) => s.id),
    ];
    expect(new Set(allGroupedIds).size).toBe(allGroupedIds.length);
    expect(allGroupedIds).toHaveLength(3);
  });

  it("scopes VS Code sidebar to open folders by default and exposes All Projects toggle", () => {
    const scoped = deriveSidebarTree({
      sessions,
      workspaces,
      scopePaths: ["/Users/dev/rayucode-v2"],
      showAllProjects: false,
      archivedSessionIds: ["s-archived"],
    });
    expect(scoped.groups.map((g) => g.workspace.id)).toEqual(["ws-a"]);
    expect(scoped.hiddenOutOfScopeCount).toBe(1);

    const allProjects = deriveSidebarTree({
      sessions,
      workspaces,
      scopePaths: ["/Users/dev/rayucode-v2"],
      showAllProjects: true,
      archivedSessionIds: ["s-archived"],
    });
    expect(allProjects.groups.map((g) => g.workspace.id)).toEqual([
      "ws-a",
      "ws-b",
    ]);
    expect(allProjects.hiddenOutOfScopeCount).toBe(0);
  });

  it("reuses a single provisional blank draft across repeated New Chat clicks", () => {
    const d1 = createOrReuseDraft(null, {
      workspaceId: "ws-a",
      workingDir: "/Users/dev/rayucode-v2",
    }, 1000);
    const d2 = createOrReuseDraft(d1, {
      workspaceId: "ws-a",
      workingDir: "/Users/dev/rayucode-v2/",
    }, 2000);
    expect(d2.draftId).toBe(d1.draftId);
    expect(d2.createdAt).toBe(1000);

    const tree = deriveSidebarTree({
      sessions,
      workspaces,
      activeDraft: d2,
    });
    expect(tree.groups.filter((g) => g.hasDraft)).toHaveLength(1);
    expect(tree.groups.find((g) => g.workspace.id === "ws-a")?.hasDraft).toBe(
      true
    );
    expect(tree.ungroupedHasDraft).toBe(false);
  });

  it("formats daemon version labels without double-prefixing non-numeric server strings", () => {
    expect(formatDaemonVersionLabel("rayu-harness-api-bridge/0.1.0")).toBe(
      "v0.1.0"
    );
    expect(formatDaemonVersionLabel("0.1.0")).toBe("v0.1.0");
    expect(formatDaemonVersionLabel("v1.14.0")).toBe("v1.14.0");
    expect(formatDaemonVersionLabel("rayu-harness-v1")).toBe("rayu-harness-v1");
  });

  it("normalizes session sources, maps filter groups, and formats human labels", () => {
    expect(normalizeSessionSource(undefined)).toBe("rayu");
    expect(normalizeSessionSource(null)).toBe("rayu");
    expect(normalizeSessionSource("unknown-tool")).toBe("rayu");
    expect(normalizeSessionSource("claude_code")).toBe("claude_code");
    expect(normalizeSessionSource("claude-desktop")).toBe("claude_desktop");
    expect(normalizeSessionSource("codex")).toBe("codex");
    expect(normalizeSessionSource("codex_desktop")).toBe("codex_desktop");
    expect(normalizeSessionSource("cursor")).toBe("cursor");
    expect(normalizeSessionSource("opencode")).toBe("opencode");
    expect(normalizeSessionSource("pi")).toBe("pi");

    expect(sessionSourceToFilterGroup("claude_code")).toBe("claude");
    expect(sessionSourceToFilterGroup("claude_desktop")).toBe("claude");
    expect(sessionSourceToFilterGroup("codex")).toBe("codex");
    expect(sessionSourceToFilterGroup("codex_desktop")).toBe("codex");
    expect(sessionSourceToFilterGroup("cursor")).toBe("cursor");
    expect(sessionSourceToFilterGroup("opencode")).toBe("opencode");
    expect(sessionSourceToFilterGroup("pi")).toBe("pi");
    expect(sessionSourceToFilterGroup(undefined)).toBe("rayu");

    expect(formatSessionSourceLabel("rayu")).toBe("RayuCode");
    expect(formatSessionSourceLabel("claude_code")).toBe("Claude Code");
    expect(formatSessionSourceLabel("claude_desktop")).toBe("Claude Desktop");
    expect(formatSessionSourceLabel("codex")).toBe("Codex CLI");
    expect(formatSessionSourceLabel("codex_desktop")).toBe("Codex Desktop");
    expect(formatSessionSourceLabel("cursor")).toBe("Cursor");
    expect(formatSessionSourceLabel("opencode")).toBe("OpenCode");
    expect(formatSessionSourceLabel("pi")).toBe("Pi");
  });

  it("computes sourceCounts before sourceFilter and filters groups, ungrouped, pinned, and flat", () => {
    const mixedSessions: SidebarSessionLike[] = [
      {
        id: "s-rayu",
        title: "Native Rayu chat",
        workingDir: "/Users/dev/rayucode-v2",
        updatedAtMs: 700,
        source: "rayu",
      },
      {
        id: "s-claude-cli",
        title: "Claude CLI chat",
        workingDir: "/Users/dev/rayucode-v2",
        updatedAtMs: 650,
        source: "claude_code",
        externalSessionId: "cc-1",
        imported: false,
      },
      {
        id: "s-claude-desktop",
        title: "Claude Desktop chat",
        workingDir: "",
        updatedAtMs: 640,
        source: "claude_desktop",
        externalProjectName: "Desktop Project",
        imported: true,
        syncStale: true,
      },
      {
        id: "s-codex-cli",
        title: "Codex CLI chat",
        workingDir: "/Users/dev/rayucode-v2",
        updatedAtMs: 600,
        source: "codex",
      },
      {
        id: "s-codex-desktop",
        title: "Codex Desktop chat",
        workingDir: "/Users/dev/other-repo",
        updatedAtMs: 590,
        source: "codex_desktop",
      },
      {
        id: "s-cursor",
        title: "Cursor chat",
        workingDir: "",
        updatedAtMs: 550,
        source: "cursor",
      },
      {
        id: "s-archived-claude",
        title: "Archived Claude chat",
        workingDir: "/Users/dev/rayucode-v2",
        updatedAtMs: 500,
        source: "claude_code",
        archived: true,
      },
    ];

    const claudeTree = deriveSidebarTree({
      sessions: mixedSessions,
      workspaces,
      pinnedSessionIds: ["s-rayu", "s-claude-cli", "s-codex-cli"],
      sourceFilter: "claude",
    });

    expect(claudeTree.activeSourceFilter).toBe("claude");
    // Counts include all non-archived, scope-visible sessions BEFORE applying sourceFilter
    expect(claudeTree.sourceCounts).toEqual({
      all: 6,
      rayu: 1,
      claude: 2,
      codex: 2,
      cursor: 1,
      opencode: 0,
      pi: 0,
    });
    expect(
      claudeTree.groups.find((g) => g.workspace.id === "ws-a")?.sessions.map((s) => s.id)
    ).toEqual(["s-claude-cli"]);
    expect(
      claudeTree.groups.find((g) => g.workspace.id === "ws-b")?.sessions.map((s) => s.id)
    ).toEqual([]);
    expect(claudeTree.ungrouped.map((s) => s.id)).toEqual(["s-claude-desktop"]);
    expect(claudeTree.pinned.map((s) => s.id)).toEqual(["s-claude-cli"]);
    expect(claudeTree.flat.map((s) => s.id)).toEqual([
      "s-claude-cli",
      "s-claude-desktop",
    ]);

    // Codex filter matches both codex and codex_desktop, respecting scopePaths for sourceCounts
    const scopedCodexTree = deriveSidebarTree({
      sessions: mixedSessions,
      workspaces,
      scopePaths: ["/Users/dev/rayucode-v2"],
      showAllProjects: false,
      sourceFilter: "codex",
    });
    // s-codex-desktop belongs to out-of-scope ws-b, so it is excluded from scope-visible sourceCounts
    expect(scopedCodexTree.sourceCounts).toEqual({
      all: 5,
      rayu: 1,
      claude: 2,
      codex: 1,
      cursor: 1,
      opencode: 0,
      pi: 0,
    });
    expect(scopedCodexTree.flat.map((s) => s.id)).toEqual(["s-codex-cli"]);
  });
});
