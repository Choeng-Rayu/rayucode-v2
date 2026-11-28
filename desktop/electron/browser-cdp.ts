import { webContents, type WebContents } from "electron"

interface AxNodeLike {
  nodeId?: string
  ignored?: boolean
  role?: { value?: string }
  name?: { value?: string }
  value?: { value?: string }
  backendDOMNodeId?: number
}

const INTERACTIVE_ROLES = new Set([
  "link",
  "button",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "tab",
  "menuitem",
  "switch",
  "slider",
  "option",
])

const SEMANTIC_ROLES = new Set([
  "heading",
  "StaticText",
  "paragraph",
  "listitem",
  "img",
  "banner",
  "navigation",
  "main",
])

export class BrowserCdpController {
  private refToBackendNodeId = new Map<string, number>()
  private attachedWebContents = new Set<WebContents>()
  private detachTimers = new WeakMap<WebContents, ReturnType<typeof setTimeout>>()
  private ensureBrowserOpen?: (url?: string) => Promise<void> | void
  private readonly ensureOpenTimeoutMs: number
  private readonly pollIntervalMs: number

  constructor(options?: { ensureOpenTimeoutMs?: number; pollIntervalMs?: number }) {
    this.ensureOpenTimeoutMs = options?.ensureOpenTimeoutMs ?? 2500
    this.pollIntervalMs = options?.pollIntervalMs ?? 100
  }

  private scheduleIdleDetach(wc: WebContents): void {
    const prev = this.detachTimers.get(wc)
    if (prev) clearTimeout(prev)
    const timer = setTimeout(() => {
      this.detachTimers.delete(wc)
      this.detachWebContents(wc)
    }, 30_000)
    this.detachTimers.set(wc, timer)
  }

  private detachWebContents(wc: WebContents): void {
    const timer = this.detachTimers.get(wc)
    if (timer) {
      clearTimeout(timer)
      this.detachTimers.delete(wc)
    }
    this.attachedWebContents.delete(wc)
    try {
      if (!wc.isDestroyed() && wc.debugger.isAttached()) {
        wc.debugger.detach()
      }
    } catch {
      // ignore detach errors during shutdown
    }
  }

  detachAll(): void {
    for (const wc of Array.from(this.attachedWebContents)) {
      this.detachWebContents(wc)
    }
    this.refToBackendNodeId.clear()
  }

  setEnsureBrowserOpen(
    callback: ((url?: string) => Promise<void> | void) | undefined
  ): void {
    this.ensureBrowserOpen = callback
  }

  private findBrowserWebContents(): WebContents | null {
    const all = webContents.getAllWebContents()
    // Prefer the embedded <webview> right-sidebar browser
    const webview = all.find(
      (wc) => !wc.isDestroyed() && wc.getType() === "webview"
    )
    return webview ?? null
  }

  private async requireBrowserWebContents(
    url?: string
  ): Promise<WebContents | null> {
    const existing = this.findBrowserWebContents()
    if (existing) return existing

    if (!this.ensureBrowserOpen) {
      return null
    }

    try {
      await this.ensureBrowserOpen(url)
    } catch {
      // Continue polling in case the renderer still mounted the webview
    }

    const deadline = Date.now() + this.ensureOpenTimeoutMs
    while (Date.now() < deadline) {
      const found = this.findBrowserWebContents()
      if (found) return found
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs))
    }

    return this.findBrowserWebContents()
  }

  private async ensureDebuggerAttached(wc: WebContents): Promise<void> {
    if (!wc.debugger.isAttached()) {
      try {
        wc.debugger.attach("1.3")
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!/already attached/i.test(msg)) {
          throw err
        }
      }
    }
    if (!this.attachedWebContents.has(wc)) {
      this.attachedWebContents.add(wc)
      wc.once("destroyed", () => {
        this.detachTimers.delete(wc)
        this.attachedWebContents.delete(wc)
      })
    }
    this.scheduleIdleDetach(wc)
    try {
      await wc.debugger.sendCommand("DOM.enable")
      await wc.debugger.sendCommand("Accessibility.enable")
    } catch {
      // domains may already be enabled
    }
  }

  async navigate(
    rawUrl: string
  ): Promise<{ ok: boolean; url: string; title: string; error?: string }> {
    const trimmed = rawUrl.trim()
    const target = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : /^(localhost|127\.0\.0\.1|\[::1\]|[^/]+\.local)(:\d+)?(\/|$)/i.test(
            trimmed
          )
        ? `http://${trimmed}`
        : `https://${trimmed}`
    const wc = await this.requireBrowserWebContents(target)
    if (!wc) {
      return {
        ok: false,
        url: rawUrl,
        title: "",
        error:
          "No active embedded browser tab is open. Open the Browser panel in the right sidebar first.",
      }
    }

    try {
      await wc.loadURL(target)
      return {
        ok: true,
        url: wc.getURL(),
        title: wc.getTitle(),
      }
    } catch (err) {
      return {
        ok: false,
        url: wc.getURL() || target,
        title: wc.getTitle(),
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  async snapshot(): Promise<{
    ok: boolean
    url: string
    title: string
    refCount: number
    tree: string
    error?: string
  }> {
    const wc = await this.requireBrowserWebContents()
    if (!wc) {
      return {
        ok: false,
        url: "",
        title: "",
        refCount: 0,
        tree: "",
        error:
          "No active embedded browser tab is open. Open the Browser panel in the right sidebar first.",
      }
    }

    try {
      await this.ensureDebuggerAttached(wc)
      const res = (await wc.debugger.sendCommand(
        "Accessibility.getFullAXTree"
      )) as { nodes?: AxNodeLike[] }

      const nodes = res?.nodes ?? []
      this.refToBackendNodeId.clear()

      const lines: string[] = []
      let refIdx = 0

      for (const node of nodes) {
        if (node.ignored) continue
        const role = String(node.role?.value ?? "").trim()
        const name = String(node.name?.value ?? "")
          .replace(/\s+/g, " ")
          .trim()
        const val = String(node.value?.value ?? "")
          .replace(/\s+/g, " ")
          .trim()

        if (!role) continue

        if (INTERACTIVE_ROLES.has(role) && node.backendDOMNodeId) {
          refIdx += 1
          const ref = `e${refIdx}`
          this.refToBackendNodeId.set(ref, node.backendDOMNodeId)
          const labelPart = name ? ` "${name.slice(0, 90)}"` : ""
          const valPart = val ? ` value="${val.slice(0, 60)}"` : ""
          lines.push(`[${ref}] ${role}${labelPart}${valPart}`)
        } else if (SEMANTIC_ROLES.has(role) && name && name.length >= 2) {
          lines.push(`  ${role}: ${name.slice(0, 140)}`)
        }

        if (lines.length >= 160) {
          lines.push("... [accessibility tree truncated at 160 items]")
          break
        }
      }

      return {
        ok: true,
        url: wc.getURL(),
        title: wc.getTitle(),
        refCount: refIdx,
        tree: lines.join("\n") || "(empty accessibility tree)",
      }
    } catch (err) {
      return {
        ok: false,
        url: wc.getURL(),
        title: wc.getTitle(),
        refCount: 0,
        tree: "",
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  async click(ref: string): Promise<{ ok: boolean; message: string }> {
    const wc = await this.requireBrowserWebContents()
    if (!wc) {
      return { ok: false, message: "No active embedded browser tab." }
    }
    const cleanRef = ref.trim().replace(/^\[|\]$/g, "")
    const backendNodeId = this.refToBackendNodeId.get(cleanRef)
    if (!backendNodeId) {
      return {
        ok: false,
        message: `Unknown element ref "${ref}". Run browser_snapshot first to get fresh refs.`,
      }
    }

    try {
      await this.ensureDebuggerAttached(wc)
      try {
        await wc.debugger.sendCommand("DOM.scrollIntoViewIfNeeded", {
          backendNodeId,
        })
      } catch {
        // ignore if already visible
      }

      try {
        const box = (await wc.debugger.sendCommand("DOM.getBoxModel", {
          backendNodeId,
        })) as { model?: { content?: number[] } }
        const quad = box?.model?.content
        if (quad && quad.length >= 6) {
          const x = Math.round((quad[0] + quad[4]) / 2)
          const y = Math.round((quad[1] + quad[5]) / 2)
          await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x,
            y,
          })
          await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x,
            y,
            button: "left",
            clickCount: 1,
          })
          await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x,
            y,
            button: "left",
            clickCount: 1,
          })
          return { ok: true, message: `Clicked [${cleanRef}] at (${x}, ${y})` }
        }
      } catch {
        // Fallback to JS click via DOM.resolveNode
      }

      const resolved = (await wc.debugger.sendCommand("DOM.resolveNode", {
        backendNodeId,
      })) as { object?: { objectId?: string } }
      if (resolved?.object?.objectId) {
        await wc.debugger.sendCommand("Runtime.callFunctionOn", {
          objectId: resolved.object.objectId,
          functionDeclaration: "function() { this.click(); }",
        })
        return { ok: true, message: `Clicked [${cleanRef}]` }
      }

      return { ok: false, message: `Could not resolve [${cleanRef}] in DOM.` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/no node with given id|could not find node|stale/i.test(msg)) {
        this.refToBackendNodeId.delete(cleanRef)
        await this.snapshot().catch(() => null)
        return {
          ok: false,
          message: `Element [${cleanRef}] became stale after DOM change. Refs refreshed; run browser_snapshot and retry.`,
        }
      }
      return {
        ok: false,
        message: msg,
      }
    }
  }

  async type(
    ref: string,
    text: string,
    submit = false
  ): Promise<{ ok: boolean; message: string }> {
    const wc = await this.requireBrowserWebContents()
    if (!wc) {
      return { ok: false, message: "No active embedded browser tab." }
    }
    const cleanRef = ref.trim().replace(/^\[|\]$/g, "")
    const backendNodeId = this.refToBackendNodeId.get(cleanRef)
    if (!backendNodeId) {
      return {
        ok: false,
        message: `Unknown element ref "${ref}". Run browser_snapshot first to get fresh refs.`,
      }
    }

    try {
      await this.ensureDebuggerAttached(wc)
      await wc.debugger.sendCommand("DOM.focus", { backendNodeId })
      await wc.debugger.sendCommand("Input.insertText", { text })
      if (submit) {
        await wc.debugger.sendCommand("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13,
        })
        await wc.debugger.sendCommand("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13,
        })
      }
      return {
        ok: true,
        message: `Typed "${text}" into [${cleanRef}]${submit ? " and submitted" : ""}`,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/no node with given id|could not find node|stale/i.test(msg)) {
        this.refToBackendNodeId.delete(cleanRef)
        await this.snapshot().catch(() => null)
        return {
          ok: false,
          message: `Element [${cleanRef}] became stale after DOM change. Refs refreshed; run browser_snapshot and retry.`,
        }
      }
      return {
        ok: false,
        message: msg,
      }
    }
  }

  async screenshot(): Promise<{
    ok: boolean
    url: string
    title: string
    dataUrl: string
    error?: string
  }> {
    const wc = await this.requireBrowserWebContents()
    if (!wc) {
      return {
        ok: false,
        url: "",
        title: "",
        dataUrl: "",
        error: "No active embedded browser tab.",
      }
    }
    try {
      const img = await wc.capturePage()
      const size = img.getSize()
      const resized =
        size.width > 1024 ? img.resize({ width: 1024 }) : img
      return {
        ok: true,
        url: wc.getURL(),
        title: wc.getTitle(),
        dataUrl: resized.toDataURL(),
      }
    } catch (err) {
      return {
        ok: false,
        url: wc.getURL(),
        title: wc.getTitle(),
        dataUrl: "",
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}
