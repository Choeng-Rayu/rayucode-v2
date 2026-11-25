import { describe, expect, it } from "vitest";

import {
  createOrReuseDraft,
  deriveSidebarTree,
  formatDaemonVersionLabel,
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
});
