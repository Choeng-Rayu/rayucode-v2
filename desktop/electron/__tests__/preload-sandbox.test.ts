import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { describe, expect, it, vi } from "vitest"

describe("Electron 45 sandboxed preload script", () => {
  it("runs cleanly with ONLY sandbox globals (require, process, global) and exposes window.rayu", () => {
    const preloadPath = path.resolve(__dirname, "..", "preload.cjs")
    const source = fs.readFileSync(preloadPath, "utf8")

    const exposed: Record<string, unknown> = {}
    const invokeSpy = vi.fn().mockResolvedValue({ ok: true })
    const onSpy = vi.fn()
    const removeListenerSpy = vi.fn()

    const mockElectron = {
      contextBridge: {
        exposeInMainWorld: (key: string, api: unknown) => {
          exposed[key] = api
        },
      },
      ipcRenderer: {
        invoke: invokeSpy,
        on: onSpy,
        removeListener: removeListenerSpy,
      },
    }

    // Exact Electron 45 sandboxed preload environment: NO `exports`, NO `module`, NO `Buffer`
    const sandboxGlobal: Record<string, unknown> = {}
    sandboxGlobal.global = sandboxGlobal
    sandboxGlobal.process = { versions: { electron: "45.4.1" } }
    sandboxGlobal.require = (specifier: string) => {
      if (specifier === "electron") return mockElectron
      throw new Error(`Module not available in sandboxed preload: ${specifier}`)
    }

    vm.runInNewContext(source, sandboxGlobal, { filename: preloadPath })

    const rayu = exposed.rayu as Record<string, Record<string, unknown>>
    expect(rayu).toBeDefined()
    expect(typeof rayu.auth?.signInWithBrowser).toBe("function")
    expect(typeof rayu.auth?.signInWithApiKey).toBe("function")
    expect(typeof rayu.auth?.signOut).toBe("function")
    expect(typeof rayu.cloud?.streamChat).toBe("function")
    expect(typeof rayu.daemon?.getStatus).toBe("function")
    expect(typeof rayu.harness?.sendMessage).toBe("function")
    expect(typeof rayu.harness?.archiveSession).toBe("function")
    expect(typeof rayu.harness?.restoreSession).toBe("function")
    expect(typeof rayu.harness?.setPermissionMode).toBe("function")
    expect(typeof rayu.desktop?.onArtifact).toBe("function")
    expect(typeof rayu.browser?.onEnsureOpen).toBe("function")
    expect(typeof rayu.workspace?.pickFolder).toBe("function")
    expect(typeof rayu.workspace?.pickFiles).toBe("function")
    expect(typeof rayu.workspace?.captureAppshot).toBe("function")
    expect(typeof rayu.workspace?.listFiles).toBe("function")
    expect(typeof rayu.workspace?.listRecent).toBe("function")
    expect(typeof rayu.storage?.getPreferences).toBe("function")
    expect(typeof rayu.storage?.updatePreferences).toBe("function")
    expect(typeof rayu.storage?.getSessionStore).toBe("function")
    expect(typeof rayu.storage?.saveSessionStore).toBe("function")
    expect(typeof rayu.storage?.getTemplates).toBe("function")
    expect(typeof rayu.storage?.saveTemplate).toBe("function")
    expect(typeof rayu.storage?.deleteTemplate).toBe("function")
    expect(typeof rayu.extensions?.list).toBe("function")
    expect(typeof rayu.extensions?.upsertMcp).toBe("function")
    expect(typeof rayu.extensions?.removeMcp).toBe("function")
    expect(typeof rayu.extensions?.createSkill).toBe("function")
    expect(typeof rayu.extensions?.toggleSkill).toBe("function")
    expect(typeof rayu.git?.getChanges).toBe("function")
    expect(typeof rayu.terminal?.runCommand).toBe("function")
    expect(typeof rayu.native?.openInPowerPoint).toBe("function")
    expect(typeof rayu.native?.openExternal).toBe("function")
    expect(typeof rayu.telegram?.getState).toBe("function")
    expect(typeof rayu.telegram?.startHosted).toBe("function")
    expect(typeof rayu.telegram?.connectBotToken).toBe("function")
    expect(typeof rayu.telegram?.disconnect).toBe("function")
    expect(typeof rayu.telegram?.resolveApproval).toBe("function")
    expect(typeof rayu.telegram?.setRemoteUninstall).toBe("function")
    expect(typeof rayu.telegram?.selectSession).toBe("function")
    expect(typeof rayu.telegram?.sendTestPing).toBe("function")
  })
})
