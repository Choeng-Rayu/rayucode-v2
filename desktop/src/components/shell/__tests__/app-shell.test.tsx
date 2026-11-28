import "@testing-library/jest-dom/vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { App } from "@/App"
import { AppProviders } from "@/components/providers/app-providers"
import { IconRail } from "@/components/shell/icon-rail"
import { useAppStore } from "@/lib/app-store"

describe("AppShell & IconRail", () => {
  beforeEach(() => {
    useAppStore.setState({
      theme: "dark",
      accent: "green",
      activeRoute: "home",
      activeSessionId: null,
      leftCollapsed: false,
      rightCollapsed: false,
      rightMode: "context",
      activeRightTab: "overview",
      activeDocPill: null,
      activeCodeFile: "lookup.rs",
      activeCodeLine: 21,
      fullView: false,
    })
  })

  it("renders the 6 primary RayuCode navigation items including Swarm at slot #2 in the sidebar rail", () => {
    render(
      <AppProviders>
        <IconRail />
      </AppProviders>
    )

    for (const label of [
      "Home",
      "Swarm",
      "Automations",
      "Plugins",
      "Changes",
      "Telegram Remote",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument()
    }

    expect(
      screen.getByRole("button", { name: "Plan & usage limits" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "User profile menu" })
    ).toBeInTheDocument()
  })

  it("switches dual-mode top bar between Context Mode, Diff/Files/Terminal panels, and Code Document Mode", async () => {
    await act(async () => {
      render(<App />)
    })

    // In default Context Mode, active-doc-pill is not shown
    expect(screen.queryByTestId("active-doc-pill")).not.toBeInTheDocument()

    // Click "Changes & Diff" tab (±) in the 6-icon strip -> opens two-column Diff panel
    const diffTabBtn = screen.getByRole("tab", { name: "Changes & Diff" })
    await act(async () => {
      fireEvent.click(diffTabBtn)
    })

    expect(useAppStore.getState().rightMode).toBe("document")
    expect(useAppStore.getState().activeRightTab).toBe("diff")
    expect(await screen.findByTestId("inspector-diff-panel")).toBeInTheDocument()

    // Click "Files" tab (folder) -> opens two-column Files panel with empty viewer state
    const filesTabBtn = screen.getByRole("tab", { name: "Files" })
    await act(async () => {
      fireEvent.click(filesTabBtn)
    })

    expect(useAppStore.getState().activeRightTab).toBe("files")
    expect(await screen.findByTestId("inspector-files-panel")).toBeInTheDocument()
    expect(screen.getByText("Open files appear here")).toBeInTheDocument()

    // Opening a cited code file displays active-doc-pill and closes back to Context Mode
    await act(async () => {
      useAppStore.getState().openCodeFile("lookup.rs", 21)
    })

    expect(screen.getByTestId("active-doc-pill")).toHaveTextContent("lookup.rs")

    const closeDocBtn = screen.getByRole("button", { name: "Close document" })
    await act(async () => {
      fireEvent.click(closeDocBtn)
    })

    expect(useAppStore.getState().rightMode).toBe("context")
    expect(screen.queryByTestId("active-doc-pill")).not.toBeInTheDocument()

    // Clipping chat session via right-panel drag-left shows restore-chat-bar and restores cleanly
    await act(async () => {
      useAppStore.getState().openRightTab("diff", "Changes")
      useAppStore.getState().setChatCollapsedByRight(true)
    })
    const restoreBar = await screen.findByTestId("restore-chat-bar")
    expect(restoreBar).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Show chat session/i }))
    })
    expect(useAppStore.getState().chatCollapsedByRight).toBe(false)
  })

  it("toggles Dark/Light theme and Rayu Green / Ocean Blue accent", async () => {
    await act(async () => {
      render(<App />)
    })

    // Top bar no longer renders a redundant quick theme toggle button
    expect(
      screen.queryByRole("button", { name: "Switch to light theme" })
    ).not.toBeInTheDocument()

    await act(async () => {
      useAppStore.getState().toggleTheme()
    })

    expect(useAppStore.getState().theme).toBe("light")
    expect(document.documentElement.getAttribute("data-theme")).toBe("light")

    await act(async () => {
      useAppStore.getState().setAccent("blue")
    })
    expect(useAppStore.getState().accent).toBe("blue")
    expect(document.documentElement.getAttribute("data-accent")).toBe("blue")
  })

  it("renders HomeView on home route, ChatStream + SessionComposer on workspace route, and InspectorSidebar inside RightInspectorHost", async () => {
    await act(async () => {
      render(<App />)
    })

    // Home route renders HomeView and InspectorSidebar in RightInspectorHost
    expect(screen.getByTestId("home-view")).toBeInTheDocument()
    expect(screen.getByTestId("inspector-sidebar")).toBeInTheDocument()

    // Switch to workspace route
    await act(async () => {
      useAppStore.getState().setActiveSession("ses_retire_cache")
    })

    expect(useAppStore.getState().activeRoute).toBe("workspace")
    expect(
      document.querySelector('[data-slot="chat-stream"]')
    ).toBeInTheDocument()
    expect(screen.getByTestId("session-composer-dock")).toHaveAttribute(
      "data-composer-mode",
      "workspace"
    )
  })

  it("renders SwarmView on swarm route, AutomationsView on automations route, and PreviewsHost inside RightInspectorHost", async () => {
    await act(async () => {
      render(<App />)
    })

    // Open browser preview in RightInspectorHost
    await act(async () => {
      useAppStore.getState().openDocPreview("browser", "localhost:3000")
    })
    expect(screen.getByTestId("previews-host")).toHaveAttribute(
      "data-preview-tab",
      "browser"
    )
    expect(screen.getByTestId("browser-pane")).toBeInTheDocument()

    // Open excel preview in RightInspectorHost
    await act(async () => {
      useAppStore
        .getState()
        .openDocPreview("excel", "Q4-Token-Cost-Model.xlsx")
    })
    expect(screen.getByTestId("previews-host")).toHaveAttribute(
      "data-preview-tab",
      "excel"
    )
    expect(screen.getByTestId("excel-pane")).toBeInTheDocument()

    // Open markdown preview in RightInspectorHost
    await act(async () => {
      useAppStore.getState().openDocPreview("markdown", "MIGRATION_PLAN.md")
    })
    expect(screen.getByTestId("previews-host")).toHaveAttribute(
      "data-preview-tab",
      "markdown"
    )
    expect(screen.getByTestId("markdown-pane")).toBeInTheDocument()

    // Switch to swarm route
    await act(async () => {
      useAppStore.getState().setActiveRoute("swarm")
    })
    await waitFor(() => {
      expect(
        document.querySelector('[data-slot="swarm-view"]')
      ).toBeInTheDocument()
    })

    // Switch to automations route
    await act(async () => {
      useAppStore.getState().setActiveRoute("automations")
    })
    expect(await screen.findByTestId("automations-view")).toBeInTheDocument()
  })

  it("renders Wave 3 views (PluginsView, ChangesView, TelegramView, SettingsView) across their routes", async () => {
    await act(async () => {
      render(<App />)
    })

    await act(async () => {
      useAppStore.getState().setActiveRoute("plugins")
    })
    expect(await screen.findByTestId("plugins-view")).toBeInTheDocument()

    await act(async () => {
      useAppStore.getState().setActiveRoute("changes")
    })
    expect(await screen.findByTestId("changes-view")).toBeInTheDocument()

    await act(async () => {
      useAppStore.getState().setActiveRoute("telegram")
    })
    expect(await screen.findByTestId("telegram-view")).toBeInTheDocument()

    await act(async () => {
      useAppStore.getState().setActiveRoute("settings")
    })
    expect(await screen.findByTestId("settings-view")).toBeInTheDocument()
  })

  it("shows vertical rail divider when sidebar is open, hides it when collapsed, and navigates history with Back/Forward", async () => {
    useAppStore.setState({
      navHistory: [{ route: "home", sessionId: null, sessionTitle: null }],
      navHistoryIndex: 0,
    })
    await act(async () => {
      render(<App />)
    })

    // Sidebar open -> vertical rail divider present
    expect(screen.getByTestId("sidebar-rail-divider")).toBeInTheDocument()

    // Navigate to a workspace session so history has [home, workspace]
    await act(async () => {
      useAppStore
        .getState()
        .setActiveSession("ses_retire_cache", "Find Khmer WAV datasets")
    })
    expect(useAppStore.getState().activeRoute).toBe("workspace")

    // Collapse left sidebar -> no vertical divider, clean TopBar shows Back (<) and Forward (>)
    await act(async () => {
      useAppStore.getState().setLeftCollapsed(true)
    })
    expect(
      screen.queryByTestId("sidebar-rail-divider")
    ).not.toBeInTheDocument()

    const backBtn = screen.getByRole("button", { name: "Back" })
    const forwardBtn = screen.getByRole("button", { name: "Forward" })
    expect(backBtn).toBeEnabled()
    expect(forwardBtn).toBeDisabled()

    await act(async () => {
      fireEvent.click(backBtn)
    })
    expect(useAppStore.getState().activeRoute).toBe("home")
    expect(screen.getByRole("button", { name: "Forward" })).toBeEnabled()

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Forward" }))
    })
    expect(useAppStore.getState().activeRoute).toBe("workspace")
    expect(useAppStore.getState().activeSessionId).toBe("ses_retire_cache")
  })

  it("opens Import from other AI apps dialog, completes step on Continue, and supports hiding Getting started", async () => {
    window.localStorage.removeItem("rayu-getting-started-hidden")
    window.localStorage.removeItem("rayu-getting-started-completed-v2")
    useAppStore.setState({ gettingStartedHidden: false })

    await act(async () => {
      render(<App />)
    })

    const card = await screen.findByTestId("getting-started-card")
    expect(card).toBeInTheDocument()

    // Clicking "Import from Claude" opens the "Import from other AI apps" dialog
    const importRow = await screen.findByRole("button", {
      name: /Import from Claude/i,
    })
    await act(async () => {
      fireEvent.click(importRow)
    })

    const dialog = await screen.findByTestId("import-ai-apps-dialog")
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText("Claude Code")).toBeInTheDocument()
    expect(screen.getByText("Claude Cowork")).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    })
    await waitFor(() => {
      expect(
        screen.queryByTestId("import-ai-apps-dialog")
      ).not.toBeInTheDocument()
    })

    // Hiding setup removes Getting started card cleanly
    await act(async () => {
      useAppStore.getState().setGettingStartedHidden(true)
    })
    expect(
      screen.queryByTestId("getting-started-card")
    ).not.toBeInTheDocument()
  })
})

