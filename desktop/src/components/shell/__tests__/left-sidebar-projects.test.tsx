import "@testing-library/jest-dom/vitest"
import { QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { useAppStore } from "@/lib/app-store"
import { ipcClient } from "@/lib/ipc-client"
import { createQueryClient } from "@/lib/query-client"

import { SidebarProjectsPane } from "../sidebar-projects-pane"

function renderPane(onOpenSession = vi.fn()) {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <SidebarProjectsPane onOpenSession={onOpenSession} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

describe("SidebarProjectsPane (Codex-style projects, hover cards, edit dialog & organize menu)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAppStore.setState({
      activeRoute: "home",
      activeSessionId: null,
      activeDraft: null,
      daemonMode: "demo",
    })
  })

  it("shows mini project hover card on hover, edits name + emoji icon + source folder, and saves", async () => {
    vi.spyOn(ipcClient.workspace, "pickFolder").mockResolvedValue({
      host: "localhost",
      path: "/Users/dev/workspace/extra-folder",
      project: "extra-folder",
      branch: "main",
    })

    renderPane()

    const projectRows = await screen.findAllByTestId("sidebar-project-row")
    expect(projectRows.length).toBeGreaterThan(0)

    // Verify 2-state folder icon toggles between open and closed on click
    const toggleBtn = projectRows[0].querySelector('button[aria-expanded]')!
    expect(toggleBtn.querySelector('[data-folder-state="open"]')).toBeTruthy()
    fireEvent.click(toggleBtn)
    expect(toggleBtn.querySelector('[data-folder-state="closed"]')).toBeTruthy()
    fireEvent.click(toggleBtn)
    expect(toggleBtn.querySelector('[data-folder-state="open"]')).toBeTruthy()

    // Hover project row -> mini hover card appears with Edit project action
    fireEvent.mouseEnter(projectRows[0])
    const hoverCard = await screen.findByTestId("project-hover-card")
    expect(hoverCard).toHaveTextContent("Edit project")

    // Open Edit project modal from hover card
    fireEvent.click(screen.getByTestId("hover-card-edit-project"))
    expect(await screen.findByTestId("edit-project-dialog")).toBeInTheDocument()

    // Rename project
    const nameInput = screen.getByTestId("edit-project-name-input")
    fireEvent.change(nameInput, { target: { value: "veajalabs" } })

    // Open mini emoji/icon picker and pick Rocket emoji
    fireEvent.click(screen.getByTestId("project-icon-picker-trigger"))
    const rocketBtn = await screen.findByTestId("project-emoji-rocket")
    fireEvent.click(rocketBtn)

    // Add a second source folder
    fireEvent.click(screen.getByTestId("edit-project-add-folder-btn"))
    await waitFor(() => {
      expect(
        screen.getAllByTestId("edit-project-folder-row").length
      ).toBeGreaterThanOrEqual(2)
    })

    // Save project changes
    fireEvent.click(screen.getByTestId("edit-project-save-btn"))

    await waitFor(() => {
      expect(screen.getByText("veajalabs")).toBeInTheDocument()
      expect(
        document.querySelector('[data-project-icon-kind="emoji"]')
      ).toBeTruthy()
    })
  })

  it("shows mini chat hover card and supports inline pin and archive actions", async () => {
    renderPane()

    const chatRows = await screen.findAllByTestId("sidebar-chat-row")
    expect(chatRows.length).toBeGreaterThan(0)
    const firstChatId = chatRows[0].getAttribute("data-chat-id")!

    // Hover shows mini chat hover card
    fireEvent.mouseEnter(chatRows[0])
    expect(await screen.findByTestId("chat-hover-card")).toBeInTheDocument()

    // Pin & archive controls exist and work
    const pinBtn = screen.getAllByTestId(`chat-pin-btn-${firstChatId}`)[0]
    fireEvent.click(pinBtn)

    const archiveBtn = screen.getAllByTestId(`chat-archive-btn-${firstChatId}`)[0]
    fireEvent.click(archiveBtn)

    await waitFor(() => {
      expect(
        screen.queryAllByTestId(`chat-archive-btn-${firstChatId}`).length
      ).toBe(0)
    })
  })

  it("creates a project from the Projects header + button with name and source folder", async () => {
    vi.spyOn(ipcClient.workspace, "pickFolder").mockResolvedValue({
      host: "localhost",
      path: "/Users/dev/workspace/brand-new-app",
      project: "brand-new-app",
      branch: "main",
    })
    vi.spyOn(ipcClient.workspace, "setPath").mockResolvedValue(null)

    renderPane()
    await screen.findAllByTestId("sidebar-project-row")
    expect(screen.queryByText("+ Open")).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId("sidebar-create-project-btn"))
    expect(await screen.findByTestId("create-project-dialog")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("create-project-add-folder-btn"))
    await screen.findByTestId("create-project-folder-row")

    fireEvent.change(screen.getByTestId("create-project-name-input"), {
      target: { value: "Launchpad" },
    })
    fireEvent.click(screen.getByTestId("create-project-submit-btn"))

    await waitFor(() => {
      expect(screen.queryByTestId("create-project-dialog")).not.toBeInTheDocument()
      expect(screen.getByText("Launchpad")).toBeInTheDocument()
    })
  })

  it("supports creating custom sections and switching Organize sidebar modes", async () => {
    renderPane()
    await screen.findAllByTestId("sidebar-project-row")

    // Open Organize menu -> click + New section
    const orgTrigger = screen.getByTestId("sidebar-organize-trigger")
    fireEvent.pointerDown(orgTrigger)
    fireEvent.click(orgTrigger)

    const newSecItem = await screen.findByTestId("sidebar-new-section-btn")
    fireEvent.click(newSecItem)

    const secInput = await screen.findByTestId("new-section-input")
    fireEvent.change(secInput, { target: { value: "Client Work" } })
    fireEvent.submit(secInput.closest("form")!)

    expect(await screen.findByTestId("sidebar-custom-section")).toHaveTextContent(
      "Client Work"
    )
  })

  it("groups sessions strictly by workingDir under matching projects and shows 'No chats' for empty projects", async () => {
    const now = Date.now()
    vi.spyOn(ipcClient.sidebar, "getState").mockResolvedValue({
      projects: [
        {
          id: "proj_youtube",
          name: "youtube",
          folders: ["/Users/dev/workspace/youtube"],
          iconKind: "icon",
          iconValue: "folder",
          iconColor: "folder",
          updatedAt: now - 10_000,
        },
        {
          id: "proj_rayucode",
          name: "rayucode",
          folders: ["/Users/dev/workspace/rayu/rayucode-v2"],
          iconKind: "icon",
          iconValue: "folder",
          iconColor: "folder",
          updatedAt: now - 5_000,
        },
        {
          id: "proj_movie_farm",
          name: "movie-farm",
          folders: ["/Users/dev/workspace/movie-farm"],
          iconKind: "icon",
          iconValue: "folder",
          iconColor: "folder",
          updatedAt: now - 1_000,
        },
      ],
      sections: [],
      pinnedChatIds: [],
      archivedChatIds: [],
      organizeBy: "project",
      sortBy: "updated",
      showProjectChatsInRecents: true,
      manualProjectOrder: [],
    })
    vi.spyOn(ipcClient.sessions, "list").mockResolvedValue([
      {
        id: "ses_rayu_1",
        title: "Fix sidebar routing",
        project: "rayucode-v2",
        workingDir: "/Users/dev/workspace/rayu/rayucode-v2",
        checkout: "Local Checkout",
        branch: "main",
        updatedAt: "3h",
        updatedAtMs: now - 3 * 3600_000,
        connection: "cloud",
        modelId: "claude-opus-5-5",
        modelLabel: "Claude Opus 5.5",
        effort: "Medium",
        permissionMode: "default",
        kvWarmPct: 0,
        creditsUsed: 0,
      },
      {
        id: "ses_movie_1",
        title: "Tell me about movie-farm",
        project: "movie-farm",
        workingDir: "/Users/dev/workspace/movie-farm",
        checkout: "Local Checkout",
        branch: "main",
        updatedAt: "5m",
        updatedAtMs: now - 5 * 60_000,
        connection: "local",
        modelId: "claude-opus-5-5",
        modelLabel: "Claude Opus 5.5",
        effort: "Medium",
        permissionMode: "default",
        kvWarmPct: 0,
        creditsUsed: 0,
      },
    ])
    vi.spyOn(ipcClient.sessions, "listProjects").mockResolvedValue([
      {
        id: "proj_movie_farm_discovered",
        name: "movie-farm",
        path: "/Users/dev/workspace/movie-farm",
        expanded: true,
        sessions: [
          {
            id: "ses_movie_1",
            title: "Tell me about movie-farm",
            workingDir: "/Users/dev/workspace/movie-farm",
          },
        ],
      },
    ])
    vi.spyOn(ipcClient.sessions, "listRecents").mockResolvedValue([
      { id: "ses_movie_1", title: "Tell me about movie-farm" },
      { id: "ses_rayu_1", title: "Fix sidebar routing" },
    ])

    renderPane()

    const rayuGroup = (await screen.findByText("rayucode")).closest(
      '[data-testid="sidebar-project-group"]'
    )!
    const movieGroup = screen
      .getByText("movie-farm")
      .closest('[data-testid="sidebar-project-group"]')!
    const youtubeGroup = screen
      .getByText("youtube")
      .closest('[data-testid="sidebar-project-group"]')!

    expect(rayuGroup).toHaveTextContent("Fix sidebar routing")
    expect(rayuGroup).not.toHaveTextContent("Tell me about movie-farm")
    expect(movieGroup).toHaveTextContent("Tell me about movie-farm")
    expect(movieGroup).not.toHaveTextContent("Fix sidebar routing")
    expect(youtubeGroup).toHaveTextContent("No chats")

    // Hover card renders real timestamp ("3h") and real connection ("cloud")
    const rayuChatRow = rayuGroup.querySelector('[data-chat-id="ses_rayu_1"]')!
    fireEvent.mouseEnter(rayuChatRow)
    const chatHoverCard = await screen.findByTestId("chat-hover-card")
    expect(chatHoverCard).toHaveTextContent("3h")
    expect(chatHoverCard.querySelector('[data-connection="cloud"]')).toBeTruthy()
  })

  it("archives active chat via ipcClient.sessions.archive, clears activeSessionId, and switches workspace on chat click", async () => {
    const now = Date.now()
    useAppStore.setState({
      activeRoute: "workspace",
      activeSessionId: "ses_a",
      activeWorkspacePath: "/Users/dev/workspace/proj-a",
    })
    const archiveSpy = vi
      .spyOn(ipcClient.sessions, "archive")
      .mockResolvedValue(undefined)
    const setPathSpy = vi
      .spyOn(ipcClient.workspace, "setPath")
      .mockResolvedValue(null)
    vi.spyOn(ipcClient.sidebar, "getState").mockResolvedValue({
      projects: [
        {
          id: "proj_a",
          name: "proj-a",
          folders: ["/Users/dev/workspace/proj-a"],
          iconKind: "icon",
          iconValue: "folder",
          iconColor: "folder",
          updatedAt: now,
        },
        {
          id: "proj_b",
          name: "proj-b",
          folders: ["/Users/dev/workspace/proj-b"],
          iconKind: "icon",
          iconValue: "folder",
          iconColor: "folder",
          updatedAt: now - 1000,
        },
      ],
      sections: [],
      pinnedChatIds: [],
      archivedChatIds: [],
      organizeBy: "project",
      sortBy: "updated",
      showProjectChatsInRecents: false,
      manualProjectOrder: [],
    })
    vi.spyOn(ipcClient.sessions, "list").mockResolvedValue([
      {
        id: "ses_a",
        title: "Alpha chat",
        project: "proj-a",
        workingDir: "/Users/dev/workspace/proj-a",
        checkout: "Local Checkout",
        branch: "main",
        updatedAt: "Now",
        updatedAtMs: now,
        connection: "local",
        modelId: "claude-opus-5-5",
        modelLabel: "Claude Opus 5.5",
        effort: "Medium",
        permissionMode: "default",
        kvWarmPct: 0,
        creditsUsed: 0,
      },
      {
        id: "ses_b",
        title: "Beta chat",
        project: "proj-b",
        workingDir: "/Users/dev/workspace/proj-b",
        checkout: "Local Checkout",
        branch: "main",
        updatedAt: "10m",
        updatedAtMs: now - 600_000,
        connection: "local",
        modelId: "claude-opus-5-5",
        modelLabel: "Claude Opus 5.5",
        effort: "Medium",
        permissionMode: "default",
        kvWarmPct: 0,
        creditsUsed: 0,
      },
    ])

    const onOpenSession = vi.fn()
    renderPane(onOpenSession)

    // Click Beta chat -> switches activeWorkspacePath to proj-b
    const betaBtn = await screen.findByRole("button", { name: "Beta chat" })
    fireEvent.click(betaBtn)
    expect(onOpenSession).toHaveBeenCalledWith("ses_b", undefined, "Beta chat")
    expect(useAppStore.getState().activeWorkspacePath).toBe(
      "/Users/dev/workspace/proj-b"
    )
    expect(setPathSpy).toHaveBeenCalledWith("/Users/dev/workspace/proj-b")

    // Archive active chat Alpha -> clears activeSessionId and calls sessions.archive
    fireEvent.click(screen.getByTestId("chat-archive-btn-ses_a"))
    await waitFor(() => {
      expect(archiveSpy).toHaveBeenCalledWith("ses_a")
      expect(useAppStore.getState().activeSessionId).toBeNull()
    })
  })

  it("caps visible chats per project at 5 with a Show more toggle and filters by searchQuery", async () => {
    const now = Date.now()
    const manySessions = Array.from({ length: 7 }, (_, i) => ({
      id: `ses_${i + 1}`,
      title: `Task item ${i + 1}`,
      project: "big-proj",
      workingDir: "/Users/dev/workspace/big-proj",
      checkout: "Local Checkout",
      branch: "main",
      updatedAt: `${i + 1}m`,
      updatedAtMs: now - (i + 1) * 60_000,
      connection: "local" as const,
      modelId: "claude-opus-5-5",
      modelLabel: "Claude Opus 5.5",
      effort: "Medium" as const,
      permissionMode: "default" as const,
      kvWarmPct: 0,
      creditsUsed: 0,
    }))
    vi.spyOn(ipcClient.sidebar, "getState").mockResolvedValue({
      projects: [
        {
          id: "proj_big",
          name: "big-proj",
          folders: ["/Users/dev/workspace/big-proj"],
          iconKind: "icon",
          iconValue: "folder",
          iconColor: "folder",
          updatedAt: now,
        },
      ],
      sections: [],
      pinnedChatIds: [],
      archivedChatIds: [],
      organizeBy: "project",
      sortBy: "updated",
      showProjectChatsInRecents: false,
      manualProjectOrder: [],
    })
    vi.spyOn(ipcClient.sessions, "list").mockResolvedValue(manySessions)

    const client = createQueryClient()
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={0}>
          <SidebarProjectsPane onOpenSession={vi.fn()} searchQuery="" />
        </TooltipProvider>
      </QueryClientProvider>
    )

    expect(await screen.findByText("Task item 1")).toBeInTheDocument()
    expect(screen.queryByText("Task item 6")).not.toBeInTheDocument()
    const showMoreBtn = screen.getByRole("button", { name: /Show 2 more/i })
    fireEvent.click(showMoreBtn)
    expect(await screen.findByText("Task item 6")).toBeInTheDocument()
    expect(screen.getByText("Task item 7")).toBeInTheDocument()

    // Search filters chats live
    rerender(
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={0}>
          <SidebarProjectsPane onOpenSession={vi.fn()} searchQuery="item 6" />
        </TooltipProvider>
      </QueryClientProvider>
    )
    expect(screen.getByText("Task item 6")).toBeInTheDocument()
    expect(screen.queryByText("Task item 1")).not.toBeInTheDocument()
  })

  it("excludes auto-discovered OS temp directories (/tmp, /private/tmp, /var/folders) from Projects and Recents while keeping real project folders", async () => {
    const now = Date.now()
    vi.spyOn(ipcClient.sidebar, "getState").mockResolvedValue({
      projects: [],
      sections: [],
      pinnedChatIds: [],
      archivedChatIds: [],
      organizeBy: "project",
      sortBy: "updated",
      showProjectChatsInRecents: true,
      manualProjectOrder: [],
      collapsedProjectIds: [],
      hiddenProjectPaths: [],
    })
    vi.spyOn(ipcClient.sessions, "list").mockResolvedValue([
      {
        id: "ses_tmp_1",
        title: "<conversation_history> Use this context",
        project: "tmp",
        workingDir: "/tmp",
        checkout: "Local Checkout",
        branch: "main",
        updatedAt: "Now",
        updatedAtMs: now,
        connection: "local",
        modelId: "claude-opus-5-5",
        modelLabel: "Claude Opus 5.5",
        effort: "Medium",
        permissionMode: "default",
        kvWarmPct: 0,
        creditsUsed: 0,
      },
      {
        id: "ses_tmp_2",
        title: "Temp folder test",
        project: "T",
        workingDir: "/var/folders/aa/bb/T/sub",
        checkout: "Local Checkout",
        branch: "main",
        updatedAt: "5m",
        updatedAtMs: now - 300_000,
        connection: "local",
        modelId: "claude-opus-5-5",
        modelLabel: "Claude Opus 5.5",
        effort: "Medium",
        permissionMode: "default",
        kvWarmPct: 0,
        creditsUsed: 0,
      },
      {
        id: "ses_real_1",
        title: "Real project task",
        project: "rayucode-v2",
        workingDir: "/Users/tester/workspace/rayucode-v2",
        checkout: "Local Checkout",
        branch: "main",
        updatedAt: "1m",
        updatedAtMs: now - 60_000,
        connection: "local",
        modelId: "claude-opus-5-5",
        modelLabel: "Claude Opus 5.5",
        effort: "Medium",
        permissionMode: "default",
        kvWarmPct: 0,
        creditsUsed: 0,
      },
    ])
    vi.spyOn(ipcClient.sessions, "listProjects").mockResolvedValue([
      {
        id: "proj_tmp",
        name: "tmp",
        path: "/tmp",
        expanded: true,
        sessions: [
          {
            id: "ses_tmp_1",
            title: "<conversation_history> Use this context",
            workingDir: "/tmp",
          },
        ],
      },
      {
        id: "proj_real",
        name: "rayucode",
        path: "/Users/tester/workspace/rayucode-v2",
        expanded: true,
        sessions: [
          {
            id: "ses_real_1",
            title: "Real project task",
            workingDir: "/Users/tester/workspace/rayucode-v2",
          },
        ],
      },
    ])
    vi.spyOn(ipcClient.sessions, "listRecents").mockResolvedValue([
      {
        id: "ses_tmp_1",
        title: "<conversation_history> Use this context",
        workingDir: "/tmp",
      },
      {
        id: "ses_tmp_2",
        title: "Temp folder test",
        workingDir: "/var/folders/aa/bb/T/sub",
      },
      {
        id: "ses_real_1",
        title: "Real project task",
        workingDir: "/Users/tester/workspace/rayucode-v2",
      },
    ])

    renderPane()

    expect(await screen.findByText("rayucode")).toBeInTheDocument()
    expect(screen.getAllByText("Real project task").length).toBeGreaterThan(0)
    expect(screen.queryByText("tmp")).not.toBeInTheDocument()
    expect(
      screen.queryByText("<conversation_history> Use this context")
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Temp folder test")).not.toBeInTheDocument()
  })

  it("auto-discovers non-hidden projects even when saved projects exist and keeps Projects and Ungrouped strictly disjoint by default", async () => {
    const now = Date.now()
    vi.spyOn(ipcClient.sidebar, "getState").mockResolvedValue({
      projects: [
        {
          id: "proj_rayucode",
          name: "rayucode",
          folders: ["/Users/dev/workspace/rayu/rayucode-v2"],
          iconKind: "icon",
          iconValue: "folder",
          iconColor: "folder",
          updatedAt: now,
        },
      ],
      sections: [],
      pinnedChatIds: [],
      archivedChatIds: [],
      organizeBy: "project",
      sortBy: "updated",
      showProjectChatsInRecents: false,
      manualProjectOrder: [],
      collapsedProjectIds: [],
      hiddenProjectPaths: ["/Users/dev/workspace/nek-rean-it"],
    })
    vi.spyOn(ipcClient.sessions, "listProjects").mockResolvedValue([
      {
        id: "proj_rayucode_auto",
        name: "rayucode-v2",
        path: "/Users/dev/workspace/rayu/rayucode-v2",
        expanded: true,
        sessions: [],
      },
      {
        id: "proj_nek",
        name: "nek-rean-it",
        path: "/Users/dev/workspace/nek-rean-it",
        expanded: true,
        sessions: [],
      },
      {
        id: "proj_youtube",
        name: "Youtube",
        path: "/Users/dev/workspace/Youtube",
        expanded: true,
        sessions: [],
      },
    ])
    vi.spyOn(ipcClient.sessions, "list").mockResolvedValue([
      {
        id: "ses_rayu_chat",
        title: "Fix sidebar routing",
        project: "rayucode-v2",
        workingDir: "/Users/dev/workspace/rayu/rayucode-v2",
        checkout: "Local Checkout",
        branch: "main",
        updatedAt: "2m",
        updatedAtMs: now - 120_000,
        connection: "local",
        modelId: "claude-opus-5-5",
        modelLabel: "Claude Opus 5.5",
        effort: "Medium",
        permissionMode: "default",
        kvWarmPct: 0,
        creditsUsed: 0,
      },
      {
        id: "ses_yt_chat",
        title: "Build remotion pipeline",
        project: "Youtube",
        workingDir: "/Users/dev/workspace/Youtube",
        checkout: "Local Checkout",
        branch: "main",
        updatedAt: "5m",
        updatedAtMs: now - 300_000,
        connection: "local",
        modelId: "claude-opus-5-5",
        modelLabel: "Claude Opus 5.5",
        effort: "Medium",
        permissionMode: "default",
        kvWarmPct: 0,
        creditsUsed: 0,
      },
      {
        id: "ses_ungrouped_chat",
        title: "Quick standalone question",
        project: "scratch",
        checkout: "Local Checkout",
        branch: "main",
        updatedAt: "1m",
        updatedAtMs: now - 60_000,
        connection: "local",
        modelId: "claude-opus-5-5",
        modelLabel: "Claude Opus 5.5",
        effort: "Medium",
        permissionMode: "default",
        kvWarmPct: 0,
        creditsUsed: 0,
      },
    ])
    vi.spyOn(ipcClient.sessions, "listRecents").mockResolvedValue([
      {
        id: "ses_rayu_chat",
        title: "Fix sidebar routing",
        workingDir: "/Users/dev/workspace/rayu/rayucode-v2",
        updatedAt: "2m",
        updatedAtMs: now - 120_000,
      },
      {
        id: "ses_yt_chat",
        title: "Build remotion pipeline",
        workingDir: "/Users/dev/workspace/Youtube",
        updatedAt: "5m",
        updatedAtMs: now - 300_000,
      },
      {
        id: "ses_ungrouped_chat",
        title: "Quick standalone question",
        updatedAt: "1m",
        updatedAtMs: now - 60_000,
      },
    ])

    renderPane()

    expect(await screen.findByText("rayucode")).toBeInTheDocument()
    // Non-hidden discovered project (Youtube) is shown; hidden project (nek-rean-it) is skipped;
    // duplicate path (rayucode-v2) is deduplicated against saved project (rayucode).
    expect(screen.getByText("Youtube")).toBeInTheDocument()
    expect(screen.queryByText("nek-rean-it")).not.toBeInTheDocument()
    expect(screen.getAllByTestId("sidebar-project-row")).toHaveLength(2)

    // Strict disjoint grouping: project chats render ONCE (only in Projects, not duplicated in Recents)
    expect(
      screen.getAllByRole("button", { name: "Fix sidebar routing" })
    ).toHaveLength(1)
    expect(
      screen.getAllByRole("button", { name: "Build remotion pipeline" })
    ).toHaveLength(1)

    // Ungrouped session appears exclusively in Recents
    const ungroupedList = screen.getByTestId("ungrouped-chat-list")
    expect(ungroupedList).toHaveTextContent("Quick standalone question")
    expect(ungroupedList).not.toHaveTextContent("Fix sidebar routing")
    expect(ungroupedList).not.toHaveTextContent("Build remotion pipeline")
  })

  it("uses lazy client-side draft via createOrReuseDraft on New chat without spawning empty daemon sessions", async () => {
    const createSessionSpy = vi.spyOn(ipcClient.sessions, "createSession")
    vi.spyOn(ipcClient.workspace, "setPath").mockResolvedValue(null)
    renderPane()

    const projectRows = await screen.findAllByTestId("sidebar-project-row")
    const projId = projectRows[0]!.getAttribute("data-project-id")!
    const newChatBtn = screen.getByTestId(`project-new-chat-${projId}`)

    fireEvent.click(newChatBtn)
    fireEvent.click(newChatBtn)

    await waitFor(() => {
      expect(screen.getAllByTestId("sidebar-draft-row")).toHaveLength(1)
    })
    expect(createSessionSpy).not.toHaveBeenCalled()
    expect(useAppStore.getState().activeDraft?.workspaceId).toBe(projId)
  })
})
