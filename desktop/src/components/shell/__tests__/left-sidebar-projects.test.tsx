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
})
