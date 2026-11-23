import "@testing-library/jest-dom/vitest"
import { QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { useAppStore } from "@/lib/app-store"
import { createQueryClient } from "@/lib/query-client"

import { CodeViewer } from "../components/code-viewer"
import { TerminalPanel } from "../components/terminal-panel"
import { ContextPanel, InspectorSidebar } from "../index"

function renderWithProviders(ui: React.ReactElement) {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>{ui}</TooltipProvider>
    </QueryClientProvider>
  )
}

describe("Inspector feature (ContextPanel, CodeViewer, TerminalPanel, InspectorSidebar)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAppStore.setState({
      theme: "dark",
      accent: "green",
      activeRoute: "workspace",
      activeSessionId: "ses_retire_cache",
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

  it("expands and collapses inline token breakdowns for all 5 dotted-underline rows", async () => {
    renderWithProviders(<ContextPanel />)

    await screen.findByText("3% used")
    expect(screen.getByText("28K / 1M")).toBeInTheDocument()

    const dottedRows: Array<{
      label: string
      breakdownTestId: string
      expectedItem: string
    }> = [
      {
        label: "MCP tools",
        breakdownTestId: "ctx-breakdown-mcp-tools",
        expectedItem: "rayu-core-mcp (18 tools)",
      },
      {
        label: "Skills",
        breakdownTestId: "ctx-breakdown-skills",
        expectedItem: "superpowers:subagent-driven-development",
      },
      {
        label: "Memory files",
        breakdownTestId: "ctx-breakdown-memory-files",
        expectedItem: "CLAUDE.md",
      },
      {
        label: "MCP server instructions",
        breakdownTestId: "ctx-breakdown-mcp-instructions",
        expectedItem: "rayu-core-mcp",
      },
      {
        label: "Custom agents",
        breakdownTestId: "ctx-breakdown-custom-agents",
        expectedItem: "coordinator · Claude Opus 5.5",
      },
    ]

    for (const row of dottedRows) {
      const trigger = screen.getByRole("button", { name: row.label })
      expect(trigger).toHaveAttribute("aria-expanded", "false")
      expect(
        screen.queryByTestId(row.breakdownTestId)
      ).not.toBeInTheDocument()

      fireEvent.click(trigger)
      expect(trigger).toHaveAttribute("aria-expanded", "true")
      const breakdown = screen.getByTestId(row.breakdownTestId)
      expect(breakdown).toBeInTheDocument()
      expect(within(breakdown).getByText(row.expectedItem)).toBeInTheDocument()

      fireEvent.click(trigger)
      expect(trigger).toHaveAttribute("aria-expanded", "false")
      expect(
        screen.queryByTestId(row.breakdownTestId)
      ).not.toBeInTheDocument()
    }

    // Bottom expandable disclosure rows
    const mcpDisclosure = screen.getByRole("button", { name: /MCP tools \(18\)/i })
    expect(mcpDisclosure).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(mcpDisclosure)
    expect(mcpDisclosure).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("rayu-core-mcp · 18 tools")).toBeInTheDocument()
    fireEvent.click(mcpDisclosure)
    expect(mcpDisclosure).toHaveAttribute("aria-expanded", "false")
  })

  it("toggles Connectors Show more and Show less for secondary connectors", async () => {
    renderWithProviders(<ContextPanel />)

    await screen.findByText("GitHub")
    expect(screen.getByText("Linear")).toBeInTheDocument()
    expect(screen.getByText("Slack")).toBeInTheDocument()

    expect(screen.queryByText("Google Drive")).not.toBeInTheDocument()
    expect(screen.queryByText("Notion")).not.toBeInTheDocument()
    expect(screen.queryByText("Sentry")).not.toBeInTheDocument()

    const showMoreBtn = screen.getByRole("button", { name: "Show more" })
    fireEvent.click(showMoreBtn)

    expect(screen.getByText("Google Drive")).toBeInTheDocument()
    expect(screen.getByText("Notion")).toBeInTheDocument()
    expect(screen.getByText("Sentry")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Show less" })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Show less" }))
    expect(screen.queryByText("Google Drive")).not.toBeInTheDocument()
    expect(screen.queryByText("Notion")).not.toBeInTheDocument()
    expect(screen.queryByText("Sentry")).not.toBeInTheDocument()
  })

  it("wires Environment settings gear, Outputs preview links, and Changes Inspect action", async () => {
    renderWithProviders(<ContextPanel />)

    await screen.findByText("Local · macOS Sequoia (M4 Max)")

    fireEvent.click(
      screen.getByRole("button", { name: "Environment settings" })
    )
    expect(useAppStore.getState().activeRoute).toBe("settings")

    fireEvent.click(
      screen.getByRole("button", { name: "Q4-Token-Cost-Model.xlsx" })
    )
    expect(useAppStore.getState().rightMode).toBe("document")
    expect(useAppStore.getState().activeRightTab).toBe("excel")
    expect(useAppStore.getState().activeDocPill).toBe(
      "Q4-Token-Cost-Model.xlsx"
    )

    fireEvent.click(screen.getByRole("button", { name: "Inspect" }))
    expect(useAppStore.getState().activeRightTab).toBe("code")
    expect(useAppStore.getState().activeCodeFile).toBe("lookup.rs")
    expect(useAppStore.getState().activeCodeLine).toBe(21)
  })

  it("highlights activeCodeLine (line 21 of lookup.rs) and switches file tabs in CodeViewer", async () => {
    renderWithProviders(<CodeViewer />)

    const pathEl = await screen.findByTestId("code-viewer-path")
    expect(pathEl).toHaveTextContent(
      "crates/rayucode-core/src/session/lookup.rs"
    )

    const line21 = document.querySelector('[data-line-number="21"]')
    expect(line21).not.toBeNull()
    expect(line21).toHaveAttribute("data-highlighted", "true")
    expect(line21).toHaveClass("border-l-brand", "bg-brand-softer")

    const storeTab = screen.getByRole("tab", { name: "store.rs" })
    fireEvent.click(storeTab)

    await waitFor(() => {
      expect(screen.getByTestId("code-viewer-path")).toHaveTextContent(
        "crates/rayucode-core/src/shard/store.rs"
      )
    })
    expect(useAppStore.getState().activeCodeFile).toBe("store.rs")
    expect(useAppStore.getState().activeCodeLine).toBe(15)

    const line15 = document.querySelector('[data-line-number="15"]')
    expect(line15).not.toBeNull()
    expect(line15).toHaveAttribute("data-highlighted", "true")

    const cacheTab = screen.getByRole("tab", { name: "cache.rs" })
    fireEvent.click(cacheTab)

    await waitFor(() => {
      expect(screen.getByTestId("code-viewer-path")).toHaveTextContent(
        "crates/rayucode-core/src/session/cache.rs"
      )
    })
    expect(useAppStore.getState().activeCodeFile).toBe("cache.rs")
    expect(useAppStore.getState().activeCodeLine).toBe(5)
  })

  it("runs interactive commands and clears output in TerminalPanel", async () => {
    renderWithProviders(<TerminalPanel />)

    await screen.findByText("rayu daemon")
    const input = screen.getByRole("textbox", {
      name: "Terminal command input",
    })
    fireEvent.change(input, { target: { value: "git status" } })
    fireEvent.submit(input.closest("form")!)

    await screen.findByText(/crates\/rayucode-core\/src\/session\/lookup\.rs/)

    fireEvent.click(screen.getByRole("button", { name: "Clear terminal" }))
    expect(
      screen.getByText(/Terminal cleared\. Type a command below/i)
    ).toBeInTheDocument()
  })

  it("switches InspectorSidebar cleanly across context, code, diff, files, and previewFallback", async () => {
    renderWithProviders(
      <InspectorSidebar
        previewFallback={(tab) => (
          <div data-testid={`custom-preview-${tab}`}>Preview: {tab}</div>
        )}
      />
    )

    await screen.findByText("3% used")

    await act(async () => {
      useAppStore.getState().openCodeFile("lookup.rs", 21)
    })
    await screen.findByTestId("inspector-code-viewer")

    await act(async () => {
      useAppStore.getState().openRightTab("diff")
    })
    const diffPanel = await screen.findByTestId("inspector-diff-panel")
    expect(within(diffPanel).getByText("Changed files")).toBeInTheDocument()
    expect(within(diffPanel).getByText("Commit changes")).toBeInTheDocument()

    // Open inline Commit changes drawer in diff panel
    fireEvent.click(within(diffPanel).getByRole("button", { name: /Commit changes/i }))
    expect(
      within(diffPanel).getByRole("textbox", { name: "Commit message" })
    ).toBeInTheDocument()

    await act(async () => {
      useAppStore.getState().openRightTab("files")
    })
    await screen.findByTestId("inspector-files-panel")

    await act(async () => {
      useAppStore.getState().openDocPreview("excel", "Q4-Token-Cost-Model.xlsx")
    })
    await screen.findByTestId("custom-preview-excel")
  })
})
