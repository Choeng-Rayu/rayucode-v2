import "@testing-library/jest-dom/vitest"
import { QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { useAppStore } from "@/lib/app-store"
import { ipcClient } from "@/lib/ipc-client"
import { createQueryClient } from "@/lib/query-client"

import { resetPreviewsCacheForTests } from "../api/previews-api"
import {
  BrowserPane,
  evaluateExcelFormula,
  ExcelPane,
  MarkdownPane,
  PreviewsHost,
} from "../index"

function renderWithProviders(ui: React.ReactElement) {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>{ui}</TooltipProvider>
    </QueryClientProvider>
  )
}

describe("Previews feature (ExcelPane, BrowserPane, FloatingAskChat, MarkdownPane, PreviewsHost)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetPreviewsCacheForTests()
    useAppStore.setState({
      theme: "dark",
      accent: "green",
      activeRoute: "workspace",
      activeSessionId: "ses_retire_cache",
      leftCollapsed: false,
      rightCollapsed: false,
      rightMode: "document",
      activeRightTab: "excel",
      activeDocPill: "Q4-Token-Cost-Model.xlsx",
      activeCodeFile: "lookup.rs",
      activeCodeLine: 21,
      fullView: false,
      liveExcelWorkbook: null,
    })
  })

  it("evaluates =SUM(...) and =AVERAGE(...) formulas across cell ranges accurately", () => {
    const cells = {
      C2: 210,
      C3: 164,
      C4: 92,
      C5: 88,
      C6: 60,
      D2: 94.5,
      D3: 93.0,
      D4: 96.2,
      D5: 91.3,
      D6: 91.0,
    }

    expect(evaluateExcelFormula("=SUM(C2:C6)", cells)).toBe(614)
    expect(evaluateExcelFormula("=AVERAGE(D2:D6)", cells)).toBe(93.2)
    expect(evaluateExcelFormula("=C2+C3", cells)).toBe(374)
  })

  it("recalculates =SUM and =AVERAGE cells live when source cells are edited in ExcelPane", async () => {
    renderWithProviders(<ExcelPane />)

    const totalTokens = await screen.findByTestId("excel-cell-C7")
    const avgKvWarm = screen.getByTestId("excel-cell-D7")
    expect(totalTokens).toHaveTextContent("614")
    expect(avgKvWarm).toHaveTextContent("93.2%")

    // Edit C2 from 210 -> 310 (+100) and verify C7 updates from 614 -> 714 immediately
    const cellC2 = screen.getByLabelText("Cell C2")
    fireEvent.focus(cellC2)
    fireEvent.change(cellC2, { target: { value: "310" } })

    expect(screen.getByTestId("excel-cell-C7")).toHaveTextContent("714")
    expect(screen.getByTestId("excel-name-box")).toHaveTextContent("C2")

    // Edit D2 from 94.5 -> 99.5 (+5.0 across 5 rows => +1.0% avg: 93.2% -> 94.2%)
    const cellD2 = screen.getByLabelText("Cell D2")
    fireEvent.focus(cellD2)
    fireEvent.change(cellD2, { target: { value: "99.5" } })

    expect(screen.getByTestId("excel-cell-D7")).toHaveTextContent("94.2%")
  })

  it("switches worksheet tabs, toggles Live Excel Web mode, calls Open in Excel App, and switches back to Context", async () => {
    const openExcelSpy = vi
      .spyOn(ipcClient.native, "openInExcel")
      .mockResolvedValue({ ok: true })

    renderWithProviders(<ExcelPane />)

    await screen.findByTestId("excel-sheet-sheet_q4")

    // Switch to Provider Unit Costs tab
    const providersTab = screen.getByRole("tab", { name: "Provider Unit Costs" })
    fireEvent.click(providersTab)
    expect(providersTab).toHaveAttribute("aria-selected", "true")
    expect(screen.getByTestId("excel-sheet-sheet_providers")).toBeInTheDocument()
    expect(screen.getByText("Blended Avg Rate")).toBeInTheDocument()

    // Switch to KV Cache Savings tab
    const cacheTab = screen.getByRole("tab", { name: "KV Cache Savings" })
    fireEvent.click(cacheTab)
    expect(cacheTab).toHaveAttribute("aria-selected", "true")
    expect(screen.getByTestId("excel-sheet-sheet_cache")).toBeInTheDocument()
    expect(screen.getByText("Total / Avg Savings")).toBeInTheDocument()

    // Open in Excel App native bridge call
    fireEvent.click(screen.getByRole("button", { name: /Open in Excel App/i }))
    expect(openExcelSpy).toHaveBeenCalledWith(
      "~/workspace/rayu/specs-and-docs/Q4-Token-Cost-Model.xlsx"
    )

    // Toggle Live Excel Web preview mode
    const liveWebToggle = screen.getByRole("button", {
      name: /Live Excel Web/i,
    })
    expect(liveWebToggle).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(liveWebToggle)
    expect(liveWebToggle).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("excel-live-web-viewer")).toBeInTheDocument()

    // No hardcoded demo embed URL: viewer stays empty until the user loads a real URL
    expect(
      screen.queryByTitle("Microsoft Excel Online Live Embed")
    ).not.toBeInTheDocument()
    expect(screen.getByTestId("excel-live-web-empty")).toBeInTheDocument()
    const embedInput = screen.getByLabelText("Office Web Viewer URL")
    expect(embedInput).toHaveValue("")
    fireEvent.change(embedInput, {
      target: { value: "https://example.com/budget.xlsx" },
    })
    fireEvent.submit(embedInput.closest("form")!)
    const embedFrame = screen.getByTitle("Microsoft Excel Online Live Embed")
    expect(embedFrame).toBeInTheDocument()
    expect(embedFrame.getAttribute("src")).toContain(
      encodeURIComponent("https://example.com/budget.xlsx")
    )
    expect(embedFrame.getAttribute("src")).not.toContain("rayucode.com/demo")

    // Switch back to interactive grid
    fireEvent.click(screen.getByRole("button", { name: /Local workbook/i }))
    expect(screen.getByTestId("excel-grid-scroll")).toBeInTheDocument()

    // Context switcher button closes document back to context mode
    fireEvent.click(screen.getByRole("button", { name: "Context" }))
    expect(useAppStore.getState().rightMode).toBe("context")
    expect(useAppStore.getState().activeRightTab).toBe("overview")
  })

  it("shows a clean empty state in production mode until hydrated by write_excel or Open .xlsx", async () => {
    useAppStore.getState().setLiveExcelWorkbook(null)
    renderWithProviders(<ExcelPane allowDemoFallback={false} />)

    expect(screen.getByTestId("excel-empty-state")).toHaveTextContent(
      "No workbook open yet"
    )
    expect(screen.getByTestId("excel-pane")).toHaveTextContent("No workbook open")
    expect(screen.getByTestId("excel-pane")).not.toHaveTextContent(
      "Q4-Token-Cost-Model.xlsx"
    )

    await act(async () => {
      useAppStore.getState().setLiveExcelWorkbook({
        fileName: "prod-model.xlsx",
        filePath: "/tmp/prod-model.xlsx",
        sheets: [
          {
            id: "sheet_prod",
            name: "Summary",
            columns: ["A", "B"],
            headers: { A: "Metric", B: "Value" },
            rows: [{ rowNumber: 2, cells: { A: "Latency", B: 144 } }],
          },
        ],
      })
    })

    expect(screen.queryByTestId("excel-empty-state")).not.toBeInTheDocument()
    expect(screen.getByTestId("excel-sheet-sheet_prod")).toBeInTheDocument()
    expect(screen.getByTestId("excel-pane")).toHaveTextContent("prod-model.xlsx")
  })

  it("hydrates ExcelPane live from a freshly written workbook (write_excel artifact)", async () => {
    renderWithProviders(<ExcelPane />)
    await screen.findByTestId("excel-sheet-sheet_q4")

    await act(async () => {
      useAppStore.getState().setLiveExcelWorkbook({
        fileName: "live-costs.xlsx",
        filePath: "/tmp/live-costs.xlsx",
        sheets: [
          {
            id: "sheet_live",
            name: "Live Costs",
            columns: ["A", "B"],
            headers: { A: "Item", B: "Cost" },
            rows: [{ rowNumber: 2, cells: { A: "Widget", B: 42 } }],
          },
        ],
      })
    })

    expect(await screen.findByRole("tab", { name: "Live Costs" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    expect(screen.getByTestId("excel-sheet-sheet_live")).toBeInTheDocument()
    expect(screen.getByLabelText("Cell B2")).toHaveValue("42")
    expect(screen.getByTestId("excel-pane")).toHaveTextContent("live-costs.xlsx")
    expect(
      screen.queryByRole("tab", { name: "Provider Unit Costs" })
    ).not.toBeInTheDocument()
  })

  it("renders a clean SlidePane empty state and sends real follow-up prompts for Request edits", async () => {
    const baseDeck = useAppStore.getState().slideDeck
    useAppStore.setState({ slideDeck: null, activeSessionId: "ses_retire_cache" })
    const { unmount } = renderWithProviders(<PreviewsHost />)
    await act(async () => {
      useAppStore.setState({ activeRightTab: "slide" })
    })

    const emptyPane = await screen.findByTestId("slide-pane")
    expect(emptyPane).toHaveAttribute("data-empty", "true")
    expect(emptyPane).toHaveTextContent("No presentation open yet")
    expect(emptyPane).not.toHaveTextContent("Enterprise Quarterly Business Review")
    unmount()

    useAppStore.setState({
      slideDeck: {
        title: "Roadmap 2027",
        templateName: "roadmap.pptx",
        filePath: "/tmp/roadmap.pptx",
        activeSlideIndex: 1,
        slides: [
          {
            id: "s1",
            kicker: "",
            title: "Cover",
            subtitle: "",
            body: "Intro body",
          },
          {
            id: "s2",
            kicker: "",
            title: "Milestones",
            subtitle: "",
            body: "Milestone body",
          },
        ],
      },
    })
    renderWithProviders(<PreviewsHost />)
    expect(await screen.findByTestId("slide-pane")).toHaveTextContent(
      "Milestones"
    )

    fireEvent.click(screen.getByTestId("slide-request-edits-btn"))
    fireEvent.change(await screen.findByTestId("slide-request-edits-input"), {
      target: { value: "make the headline punchier" },
    })
    fireEvent.submit(screen.getByTestId("slide-request-edits-input").closest("form")!)

    const queued = useAppStore.getState().pendingStreamPrompt
    expect(queued?.sessionId).toBe("ses_retire_cache")
    expect(queued?.prompt).toContain("/tmp/roadmap.pptx")
    expect(queued?.prompt).toContain("Slide 2")
    expect(queued?.prompt).toContain("Milestones")
    expect(queued?.prompt).toContain("make the headline punchier")
    // Local bullet-append hack is gone: the slide body is untouched
    expect(useAppStore.getState().slideDeck?.slides[1]?.body).toBe(
      "Milestone body"
    )

    useAppStore.setState({ slideDeck: baseDeck, pendingStreamPrompt: null })
  })

  it("handles BrowserPane zoom, device toolbar toggle, and Full View FloatingAskChat drawer", async () => {
    renderWithProviders(<BrowserPane />)

    await screen.findByText(/Credits Usage Dashboard/i)
    const pane = screen.getByTestId("browser-pane")
    expect(pane).toHaveAttribute("data-zoom", "100")
    expect(pane).toHaveAttribute("data-device-mode", "desktop")
    expect(screen.queryByTestId("floating-ask-chat")).not.toBeInTheDocument()

    // Zoom in & reset
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }))
    expect(screen.getByTestId("browser-zoom-value")).toHaveTextContent("110%")
    expect(pane).toHaveAttribute("data-zoom", "110")

    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }))
    expect(screen.getByTestId("browser-zoom-value")).toHaveTextContent("100%")

    // Switch to mobile viewport
    const mobileBtn = screen.getByRole("button", { name: "Mobile viewport" })
    fireEvent.click(mobileBtn)
    expect(mobileBtn).toHaveAttribute("aria-pressed", "true")
    expect(pane).toHaveAttribute("data-device-mode", "mobile")

    // Toggle Full View -> FloatingAskChat renders
    fireEvent.click(screen.getByRole("button", { name: "Full view" }))
    expect(useAppStore.getState().fullView).toBe(true)

    const floatingChat = await screen.findByTestId("floating-ask-chat")
    expect(floatingChat).toBeInTheDocument()

    // Send a question in FloatingAskChat
    const chatInput = screen.getByLabelText("Ask RayuCode message")
    fireEvent.change(chatInput, {
      target: { value: "Check KV cache latency on /v1/sessions/lookup" },
    })
    fireEvent.submit(chatInput.closest("form")!)

    await waitFor(() => {
      expect(
        screen.getByText("Check KV cache latency on /v1/sessions/lookup")
      ).toBeInTheDocument()
    })

    // Exit full view hides FloatingAskChat
    fireEvent.click(screen.getByRole("button", { name: "Exit full view" }))
    expect(useAppStore.getState().fullView).toBe(false)
    expect(screen.queryByTestId("floating-ask-chat")).not.toBeInTheDocument()

    // Navigate via centered pill URL bar & open a second browser tab
    const urlInput = screen.getByTestId("browser-url-input")
    fireEvent.focus(urlInput)
    fireEvent.change(urlInput, { target: { value: "jigsaw.w3.org" } })
    fireEvent.submit(urlInput.closest("form")!)
    expect(urlInput).toHaveValue("jigsaw.w3.org")

    fireEvent.click(screen.getByTestId("browser-new-tab-btn"))
    expect(screen.getAllByTestId("browser-tab-pill")).toHaveLength(2)
  })

  it("toggles MarkdownPane between Rendered and Raw views and opens in VS Code", async () => {
    const openVSCodeSpy = vi
      .spyOn(ipcClient.native, "openInVSCode")
      .mockResolvedValue({ ok: true })

    renderWithProviders(<MarkdownPane />)

    await screen.findByTestId("markdown-rendered-view")
    expect(screen.getByTestId("markdown-file-path")).toHaveTextContent(
      "docs/MIGRATION_PLAN.md"
    )
    expect(
      screen.getByRole("heading", {
        name: /SessionCache Retirement & ShardStore Migration/i,
      })
    ).toBeInTheDocument()

    // Switch to Raw mode (Radix Tabs trigger)
    const rawTab = screen.getByRole("tab", { name: /Raw/i })
    fireEvent.mouseDown(rawTab)
    fireEvent.click(rawTab)

    const rawView = await screen.findByTestId("markdown-raw-view")
    expect(rawView).toBeInTheDocument()
    expect(rawView.querySelector('[data-line-number="1"]')).toHaveTextContent(
      "# SessionCache Retirement & ShardStore Migration"
    )

    // Switch back to Rendered mode
    const renderedTab = screen.getByRole("tab", { name: /Rendered/i })
    fireEvent.mouseDown(renderedTab)
    fireEvent.click(renderedTab)
    await screen.findByTestId("markdown-rendered-view")

    // Open in VS Code native bridge
    fireEvent.click(screen.getByRole("button", { name: /Open in VS Code/i }))
    expect(openVSCodeSpy).toHaveBeenCalledWith("MIGRATION_PLAN.md", 1)
  })

  it("renders the matching preview pane via PreviewsHost based on activeRightTab", async () => {
    useAppStore.setState({ activeRightTab: "browser" })
    renderWithProviders(<PreviewsHost />)

    await screen.findByTestId("browser-pane")

    await act(async () => {
      useAppStore.getState().openRightTab("excel")
    })
    await screen.findByTestId("excel-pane")

    await act(async () => {
      useAppStore.getState().openRightTab("markdown")
    })
    await screen.findByTestId("markdown-pane")

    await act(async () => {
      useAppStore.getState().openRightTab("slide", "Slide")
    })
    const slidePane = await screen.findByTestId("slide-pane")
    expect(slidePane).toHaveTextContent("Enterprise Quarterly Business Review")
    expect(screen.getByTestId("slide-request-edits-btn")).toBeInTheDocument()

    // Navigate to Slide 2 via vertical slide tick rail
    fireEvent.click(screen.getByRole("tab", { name: "Slide 2" }))
    expect(slidePane).toHaveTextContent(
      "Platform Capabilities & Operational Readiness"
    )

    // Open Diagram Studio preview and toggle between Preview & Code
    await act(async () => {
      useAppStore
        .getState()
        .openDiagramPreview(
          "flowchart LR\n  A[Renderer] --> B[Preload] --> C[Main]",
          "Electron Bridge Flow"
        )
    })
    const diagramPane = await screen.findByTestId("diagram-pane")
    expect(diagramPane).toHaveTextContent("Electron Bridge Flow")
    expect(screen.getByTestId("diagram-preview-stage")).toBeInTheDocument()

    const codeTab = screen.getByTestId("diagram-mode-code")
    fireEvent.mouseDown(codeTab)
    fireEvent.click(codeTab)
    const editor = await screen.findByTestId("diagram-code-editor")
    expect(editor).toHaveValue(
      "flowchart LR\n  A[Renderer] --> B[Preload] --> C[Main]"
    )
  })
})
