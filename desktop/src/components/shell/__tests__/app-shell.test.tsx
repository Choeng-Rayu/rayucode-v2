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

  it("renders exactly the 6 primary RayuCode navigation items", () => {
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

  it("switches dual-mode top bar between Context Mode and Document Mode", async () => {
    await act(async () => {
      render(<App />)
    })

    // In default Context Mode, active-doc-pill is not shown
    expect(screen.queryByTestId("active-doc-pill")).not.toBeInTheDocument()

    // Click "Code & Changes" tab in the 6-icon strip to switch to Document Mode
    const codeTabBtn = screen.getByRole("tab", { name: "Code & Changes" })
    await act(async () => {
      fireEvent.click(codeTabBtn)
    })

    expect(useAppStore.getState().rightMode).toBe("document")
    expect(screen.getByTestId("active-doc-pill")).toHaveTextContent("lookup.rs")

    // Clicking the × close button on the document pill returns to Context Mode
    const closeDocBtn = screen.getByRole("button", { name: "Close document" })
    await act(async () => {
      fireEvent.click(closeDocBtn)
    })

    expect(useAppStore.getState().rightMode).toBe("context")
    expect(screen.queryByTestId("active-doc-pill")).not.toBeInTheDocument()
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
})

