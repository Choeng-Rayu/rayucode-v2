import { beforeEach, describe, expect, it } from "vitest"

import { useAppStore } from "../app-store"

describe("useAppStore", () => {
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

  it("switches rightMode between context and document cleanly", () => {
    const s = useAppStore.getState()
    s.openCodeFile("lookup.rs", 21)

    expect(useAppStore.getState().rightMode).toBe("document")
    expect(useAppStore.getState().activeRightTab).toBe("code")
    expect(useAppStore.getState().activeDocPill).toBe("lookup.rs")
    expect(useAppStore.getState().activeCodeLine).toBe(21)

    useAppStore.getState().closeDocumentToContext()
    expect(useAppStore.getState().rightMode).toBe("context")
    expect(useAppStore.getState().activeRightTab).toBe("overview")
    expect(useAppStore.getState().activeDocPill).toBeNull()
  })

  it("syncs theme and accent with document.documentElement and localStorage", () => {
    useAppStore.getState().setTheme("light")
    expect(useAppStore.getState().theme).toBe("light")
    expect(document.documentElement.getAttribute("data-theme")).toBe("light")
    expect(window.localStorage.getItem("rayu-theme")).toBe("light")

    useAppStore.getState().setAccent("blue")
    expect(useAppStore.getState().accent).toBe("blue")
    expect(document.documentElement.getAttribute("data-accent")).toBe("blue")
    expect(window.localStorage.getItem("rayu-accent")).toBe("blue")
  })

  it("toggles left and right sidebars and fullView mode", () => {
    useAppStore.getState().toggleLeftSidebar()
    expect(useAppStore.getState().leftCollapsed).toBe(true)

    useAppStore.getState().openDocPreview("excel", "Q4-Token-Cost-Model.xlsx")
    expect(useAppStore.getState().rightMode).toBe("document")
    expect(useAppStore.getState().activeRightTab).toBe("excel")
    expect(useAppStore.getState().activeDocPill).toBe("Q4-Token-Cost-Model.xlsx")

    useAppStore.getState().setFullView(true)
    expect(useAppStore.getState().fullView).toBe(true)

    useAppStore.getState().toggleRightSidebar()
    expect(useAppStore.getState().rightCollapsed).toBe(true)
    expect(useAppStore.getState().fullView).toBe(false)
  })
})
