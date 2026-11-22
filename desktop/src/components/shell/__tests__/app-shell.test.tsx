import "@testing-library/jest-dom/vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
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

    const themeBtn = screen.getByRole("button", {
      name: "Switch to light theme",
    })
    await act(async () => {
      fireEvent.click(themeBtn)
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
})

