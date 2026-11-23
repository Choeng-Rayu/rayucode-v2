import * as React from "react"
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAppStore } from "@/lib/app-store"
import { ipcClient } from "@/lib/ipc-client"
import { findMcpBlueprint } from "@/lib/mcp-registry"
import { cn } from "@/lib/utils"

import type { PluginCatalogItem } from "../types"
import { BrandLogo } from "./brand-logos"

export interface PluginDetailViewProps {
  plugin: PluginCatalogItem
  onBack: () => void
  onInstallOrConfigure: (plugin: PluginCatalogItem) => void
  onSavedMcp: () => Promise<void>
  isPending?: boolean
}

function parseEnvLines(raw: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (key && val) env[key] = val
  }
  return env
}

export function PluginDetailView({
  plugin,
  onBack,
  onInstallOrConfigure,
  onSavedMcp,
  isPending = false,
}: PluginDetailViewProps) {
  const bp = findMcpBlueprint(plugin.mcpServerId ?? plugin.id)
  const [detailTab, setDetailTab] = React.useState<"overview" | "mcp">(
    "overview"
  )
  const [mcpListOpen, setMcpListOpen] = React.useState(true)

  const initialEnvKeys = React.useMemo(() => {
    if (plugin.envKeys && plugin.envKeys.length > 0) return plugin.envKeys
    return bp?.requiredEnv?.map((e) => e.key) ?? []
  }, [bp, plugin.envKeys])

  const [serverId, setServerId] = React.useState(
    plugin.mcpServerId ?? bp?.mcpServerId ?? plugin.id.toLowerCase()
  )
  const [scope, setScope] = React.useState<"global" | "workspace">(
    plugin.scope ?? "global"
  )
  const [transport, setTransport] = React.useState<"stdio" | "url">(
    plugin.transport ?? bp?.transport ?? "stdio"
  )
  const [command, setCommand] = React.useState(
    plugin.command ?? bp?.command ?? "npx"
  )
  const [argsText, setArgsText] = React.useState(
    (plugin.args ?? bp?.args ?? []).join(" ")
  )
  const [url, setUrl] = React.useState(plugin.url ?? bp?.url ?? "")
  const [envText, setEnvText] = React.useState(
    initialEnvKeys.map((k) => `${k}=`).join("\n")
  )
  const [saving, setSaving] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)

  const endpointPreview =
    transport === "url"
      ? url || "https://..."
      : [command, ...argsText.trim().split(/\s+/).filter(Boolean)].join(" ")

  const samplePrompts = bp?.samplePrompts ?? [
    `Inspect available tools from the ${plugin.name} MCP server.`,
    `Summarize recent updates from ${plugin.name} relevant to this repository.`,
    `Use ${plugin.name} to help verify my current task.`,
  ]

  const handleRunSamplePrompt = async (promptText: string) => {
    const store = useAppStore.getState()
    const targetPrompt = `@${serverId} ${promptText}`
    const created = await ipcClient.sessions.createSession({
      prompt: targetPrompt,
      project: store.activeWorkspacePath
        ? store.activeWorkspacePath.split(/[\\/]/).filter(Boolean).pop() ??
          "No Project"
        : "No Project",
      checkout: "Local Checkout",
      modelId: "default",
      modelLabel: "Default",
      effort: "Medium",
      permissionMode: "default",
    })
    store.setPendingStreamPrompt({
      sessionId: created.id,
      prompt: targetPrompt,
      modelId: "default",
      modelLabel: "Default",
    })
    store.setActiveSession(created.id, created.title)
  }

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    const cleanId = serverId.trim()
    if (!cleanId) {
      setFormError("Enter a valid server ID.")
      return
    }
    if (transport === "url" && !url.trim()) {
      setFormError("Enter the remote MCP server URL.")
      return
    }
    if (transport === "stdio" && !command.trim()) {
      setFormError("Enter the stdio command.")
      return
    }

    setSaving(true)
    try {
      const env = parseEnvLines(envText)
      await ipcClient.plugins.upsertMcp({
        id: cleanId,
        scope,
        ...(transport === "url"
          ? { url: url.trim() }
          : {
              command: command.trim(),
              args: argsText.trim().split(/\s+/).filter(Boolean),
            }),
        ...(Object.keys(env).length > 0 ? { env } : {}),
      })
      await onSavedMcp()
      toast.success(
        `Saved "${cleanId}" to ${scope === "workspace" ? ".mcp.json" : "~/.rayu/mcp.json"}`
      )
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to save MCP configuration."
      )
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    setSaving(true)
    try {
      await ipcClient.plugins.removeMcp(serverId.trim(), scope)
      await onSavedMcp()
      toast(`Removed "${serverId.trim()}" from MCP configuration`)
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to remove MCP server."
      )
    } finally {
      setSaving(false)
    }
  }

  const jsonPreview = React.useMemo(() => {
    const entry: Record<string, unknown> =
      transport === "url"
        ? { url: url.trim() || "https://..." }
        : {
            command: command.trim() || "npx",
            args: argsText.trim().split(/\s+/).filter(Boolean),
          }
    const env = parseEnvLines(envText)
    if (Object.keys(env).length > 0) {
      entry.env = Object.fromEntries(
        Object.keys(env).map((k) => [k, "••••••••"])
      )
    }
    return JSON.stringify({ mcpServers: { [serverId || "server"]: entry } }, null, 2)
  }, [argsText, command, envText, serverId, transport, url])

  return (
    <div
      data-testid="plugin-detail-view"
      className="flex h-full min-h-0 flex-1 flex-col bg-canvas"
    >
      {/* Top Breadcrumb Bar */}
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-hairline px-6 text-xs text-muted-ink">
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer transition-colors hover:text-ink"
        >
          Customizations
        </button>
        <span aria-hidden="true">/</span>
        <span className="font-medium text-ink">{plugin.name}</span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-[820px] px-6 py-8 md:px-10 md:py-10">
          {/* Header Row: Logo + Title + Primary Add/Installed Action */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <BrandLogo name={plugin.id} size="lg" />
              <div>
                <h1 className="m-0 text-xl font-semibold tracking-tight text-ink">
                  {plugin.name}
                </h1>
                {bp?.developer ? (
                  <div className="mt-0.5 text-xs text-muted-ink">
                    by {bp.developer} ·{" "}
                    <span className="font-mono">
                      {transport === "url" ? "Remote MCP" : "Local stdio MCP"}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {plugin.installed ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="rounded-full border-brand/40 bg-brand-soft px-4 text-brand-text hover:bg-brand-soft"
                    onClick={() => setDetailTab("mcp")}
                  >
                    <Check className="size-3.5" aria-hidden="true" />
                    <span>Installed</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() => void handleRemove()}
                    className="rounded-full text-muted-ink hover:text-danger"
                  >
                    Remove
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={isPending}
                  onClick={() => {
                    if (bp?.requiredEnv && bp.requiredEnv.length > 0) {
                      setDetailTab("mcp")
                      toast(`Enter ${bp.requiredEnv[0].key} below to finish setup`)
                    } else {
                      onInstallOrConfigure(plugin)
                    }
                  }}
                  className="rounded-full px-5 font-semibold"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  <span>Add</span>
                </Button>
              )}
            </div>
          </div>

          <p className="mt-4 max-w-[68ch] text-[13.5px] leading-relaxed text-muted-ink">
            {bp?.overview ?? plugin.description}
          </p>

          {/* Interactive Sample Prompts Box */}
          <div className="mt-6 rounded-2xl border border-hairline bg-inset p-3.5">
            <div className="flex flex-col gap-1">
              {samplePrompts.map((promptText) => (
                <button
                  key={promptText}
                  type="button"
                  onClick={() => void handleRunSamplePrompt(promptText)}
                  className="group flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[13px] text-body transition-colors hover:bg-hover hover:text-ink"
                >
                  <span className="size-4 shrink-0 overflow-hidden rounded-full">
                    <BrandLogo name={plugin.id} variant="glyph" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{promptText}</span>
                  <span className="shrink-0 text-[11px] font-medium text-brand-text opacity-0 transition-opacity group-hover:opacity-100">
                    Try prompt →
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Overview | MCP Tab Bar */}
          <div className="mt-7 flex items-center gap-2 border-b border-hairline pb-4">
            <button
              type="button"
              onClick={() => setDetailTab("overview")}
              className={cn(
                "cursor-pointer rounded-full px-3.5 py-1 text-xs font-medium transition-colors",
                detailTab === "overview"
                  ? "bg-active text-ink shadow-bevel-surface"
                  : "text-muted-ink hover:bg-hover hover:text-ink"
              )}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => setDetailTab("mcp")}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-medium transition-colors",
                detailTab === "mcp"
                  ? "bg-active text-ink shadow-bevel-surface"
                  : "text-muted-ink hover:bg-hover hover:text-ink"
              )}
            >
              <span>MCP</span>
              <span className="font-mono text-[10.5px] text-muted-ink">1</span>
            </button>
          </div>

          {detailTab === "overview" ? (
            <div className="mt-8 space-y-8">
              {/* Centered Brand Hero */}
              <div className="flex flex-col items-center text-center">
                <div className="relative inline-flex items-center">
                  <BrandLogo name={plugin.id} size="lg" />
                  {bp?.websiteUrl ? (
                    <button
                      type="button"
                      aria-label={`Open ${plugin.name} website`}
                      onClick={() =>
                        void ipcClient.native.openExternal(bp.websiteUrl)
                      }
                      className="ml-2 cursor-pointer text-muted-ink transition-colors hover:text-ink"
                    >
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <h2 className="mt-4 text-xl font-semibold tracking-tight text-ink">
                  {plugin.name} for RayuCode
                </h2>
                <p className="mt-1.5 text-sm font-medium text-body">
                  {bp?.tagline ?? `Bring ${plugin.name} into your RayuCode workspace`}
                </p>
                <p className="mt-1 max-w-[46ch] text-xs leading-relaxed text-muted-ink">
                  {plugin.description}
                </p>
              </div>

              {/* Overview Copy */}
              <section className="space-y-3">
                <h3 className="text-[15px] font-semibold text-ink">Overview</h3>
                <p className="text-[13.5px] leading-relaxed text-body">
                  {bp?.overview ?? plugin.description}
                </p>
                <p className="text-[13.5px] leading-relaxed text-body">
                  {transport === "url" ? (
                    <>
                      This integration connects directly to{" "}
                      <button
                        type="button"
                        onClick={() =>
                          bp?.docsUrl &&
                          void ipcClient.native.openExternal(bp.docsUrl)
                        }
                        className="cursor-pointer font-medium text-brand-text underline-offset-2 hover:underline"
                      >
                        {plugin.name}&apos;s hosted MCP server
                      </button>
                      . No local package installation is required.
                    </>
                  ) : (
                    <>
                      This integration runs locally via{" "}
                      <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-xs text-ink">
                        {endpointPreview}
                      </code>{" "}
                      and is written directly into{" "}
                      <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-xs text-ink">
                        ~/.rayu/mcp.json
                      </code>
                      .
                    </>
                  )}
                </p>
              </section>

              {/* Quick Start */}
              <section className="space-y-4">
                <h3 className="text-[15px] font-semibold text-ink">
                  Quick start
                </h3>
                <div className="space-y-3 text-[13px] leading-relaxed text-body">
                  <div>
                    <div className="font-semibold text-ink">
                      1. Install from Customizations
                    </div>
                    <p className="mt-0.5 text-muted-ink">
                      Click <strong className="text-ink">Add</strong> above (or
                      switch to the <strong className="text-ink">MCP</strong>{" "}
                      tab) to write this server into{" "}
                      <code className="font-mono text-xs text-body">
                        ~/.rayu/mcp.json
                      </code>{" "}
                      or your project&apos;s{" "}
                      <code className="font-mono text-xs text-body">
                        .mcp.json
                      </code>
                      .
                    </p>
                  </div>
                  <div>
                    <div className="font-semibold text-ink">
                      2.{" "}
                      {bp?.requiredEnv && bp.requiredEnv.length > 0
                        ? `Provide ${bp.requiredEnv.map((e) => e.key).join(", ")}`
                        : "Ready immediately"}
                    </div>
                    <p className="mt-0.5 text-muted-ink">
                      {bp?.requiredEnv && bp.requiredEnv.length > 0
                        ? "Open the MCP tab to paste your API token into the environment variables field. Keys are stored locally with 0600 file permissions and synced to the local Rust rayu daemon."
                        : "No manual API key is needed to install this MCP server. If the remote endpoint uses OAuth, complete sign-in when prompted on first tool use."}
                    </p>
                  </div>
                  <div>
                    <div className="font-semibold text-ink">
                      3. Ask RayuCode
                    </div>
                    <blockquote className="mt-1.5 border-l-2 border-hairline-strong pl-3 text-body">
                      {samplePrompts[0]}
                    </blockquote>
                  </div>
                </div>
              </section>

              {/* Troubleshooting */}
              <section className="space-y-3">
                <h3 className="text-[15px] font-semibold text-ink">
                  Troubleshooting
                </h3>
                <div className="space-y-2.5 text-[13px] leading-relaxed text-muted-ink">
                  <div>
                    <div className="font-medium text-ink">
                      Installed, but {plugin.name} tools are unavailable
                    </div>
                    <p className="mt-0.5">
                      Open the <strong className="text-body">MCP</strong> tab to
                      verify your command or URL, and check{" "}
                      <strong className="text-body">
                        Settings → Connections &amp; Daemon
                      </strong>{" "}
                      to confirm the local Rust{" "}
                      <code className="font-mono text-xs">rayu</code> daemon is
                      running.
                    </p>
                  </div>
                  <div>
                    <div className="font-medium text-ink">
                      Credentials or workspace scope
                    </div>
                    <p className="mt-0.5">
                      Project{" "}
                      <code className="font-mono text-xs">.mcp.json</code>{" "}
                      entries override global{" "}
                      <code className="font-mono text-xs">
                        ~/.rayu/mcp.json
                      </code>{" "}
                      entries with the same server ID.
                    </p>
                  </div>
                </div>
              </section>

              {/* Collapsible MCP Servers Summary */}
              <section className="border-t border-hairline pt-5">
                <button
                  type="button"
                  onClick={() => setMcpListOpen((v) => !v)}
                  className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-ink"
                >
                  <span>MCP servers</span>
                  <span className="rounded bg-active px-1.5 py-px font-mono text-[10.5px] text-muted-ink">
                    1
                  </span>
                  {mcpListOpen ? (
                    <ChevronDown className="size-3.5 text-muted-ink" />
                  ) : (
                    <ChevronRight className="size-3.5 text-muted-ink" />
                  )}
                </button>
                {mcpListOpen && (
                  <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-inset px-3.5 py-2.5 font-mono text-xs">
                    <span className="font-semibold text-ink">{serverId}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-ink">
                      {endpointPreview}
                    </span>
                    <button
                      type="button"
                      onClick={() => setDetailTab("mcp")}
                      className="cursor-pointer font-sans text-xs font-medium text-brand-text hover:underline"
                    >
                      Configure
                    </button>
                  </div>
                )}
              </section>

              {/* Footer Developer & Links Strip */}
              <footer className="flex flex-wrap items-start justify-between gap-6 border-t border-hairline pt-6 text-xs">
                <div className="flex flex-wrap items-start gap-8">
                  <div>
                    <div className="text-muted-ink">Developer</div>
                    <div className="mt-1 font-medium text-ink">
                      {bp?.developer ?? "Custom MCP"}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-ink">Transport</div>
                    <div className="mt-1 font-mono text-ink">
                      {transport === "url" ? "Remote SSE / HTTP" : "Local stdio"}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-ink">Config file</div>
                    <div className="mt-1 font-mono text-ink">
                      {scope === "workspace" ? ".mcp.json" : "~/.rayu/mcp.json"}
                    </div>
                  </div>
                </div>

                {(bp?.websiteUrl || bp?.docsUrl || bp?.repoUrl) && (
                  <div>
                    <div className="text-muted-ink">Links</div>
                    <div className="mt-1 flex items-center gap-4">
                      {bp.websiteUrl && (
                        <button
                          type="button"
                          onClick={() =>
                            void ipcClient.native.openExternal(bp.websiteUrl)
                          }
                          className="inline-flex cursor-pointer items-center gap-1 font-medium text-ink hover:text-brand-text"
                        >
                          <span>Website</span>
                          <ExternalLink className="size-3" aria-hidden="true" />
                        </button>
                      )}
                      {bp.docsUrl && (
                        <button
                          type="button"
                          onClick={() =>
                            void ipcClient.native.openExternal(bp.docsUrl)
                          }
                          className="inline-flex cursor-pointer items-center gap-1 font-medium text-ink hover:text-brand-text"
                        >
                          <span>Documentation</span>
                          <ExternalLink className="size-3" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </footer>
            </div>
          ) : (
            /* Live MCP Tab: Real Config Editor Writing Directly to mcp.json */
            <form
              onSubmit={(e) => void handleSaveConfig(e)}
              className="mt-7 space-y-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-pane px-4 py-3 text-xs">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-3.5 text-brand-text" aria-hidden="true" />
                  <span className="font-medium text-ink">
                    {plugin.installed
                      ? `Active in ${plugin.sourcePath ?? "~/.rayu/mcp.json"}`
                      : "Not configured yet — save below to install"}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    void ipcClient.native.openInVSCode("~/.rayu/mcp.json")
                  }
                >
                  <FolderOpen className="size-3.5" aria-hidden="true" />
                  <span>Open mcp.json</span>
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label
                    htmlFor="detail-mcp-id"
                    className="text-xs font-medium text-muted-ink"
                  >
                    Server ID
                  </label>
                  <input
                    id="detail-mcp-id"
                    type="text"
                    value={serverId}
                    onChange={(e) => setServerId(e.target.value)}
                    className="h-9 w-full rounded-lg border border-control-border bg-inset px-3 font-mono text-xs text-ink focus:border-ring focus:outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-ink">
                    Config scope
                  </span>
                  <div className="grid grid-cols-2 gap-1 rounded-lg border border-hairline bg-inset p-1 text-xs">
                    {(["global", "workspace"] as const).map((sc) => (
                      <button
                        key={sc}
                        type="button"
                        onClick={() => setScope(sc)}
                        className={cn(
                          "cursor-pointer rounded-md py-1 text-center font-medium transition-colors",
                          scope === sc
                            ? "bg-active text-ink"
                            : "text-muted-ink hover:text-ink"
                        )}
                      >
                        {sc === "global" ? "~/.rayu/mcp.json" : ".mcp.json"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-ink">
                  Transport
                </span>
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-hairline bg-inset p-1 text-xs">
                  {(["stdio", "url"] as const).map((tr) => (
                    <button
                      key={tr}
                      type="button"
                      onClick={() => setTransport(tr)}
                      className={cn(
                        "cursor-pointer rounded-md py-1.5 text-center font-medium transition-colors",
                        transport === tr
                          ? "bg-active text-ink"
                          : "text-muted-ink hover:text-ink"
                      )}
                    >
                      {tr === "stdio"
                        ? "Local command (stdio)"
                        : "Remote URL (SSE / HTTP)"}
                    </button>
                  ))}
                </div>
              </div>

              {transport === "url" ? (
                <div className="space-y-1.5">
                  <label
                    htmlFor="detail-mcp-url"
                    className="text-xs font-medium text-muted-ink"
                  >
                    Server URL
                  </label>
                  <input
                    id="detail-mcp-url"
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://mcp.linear.app/sse"
                    className="h-9 w-full rounded-lg border border-control-border bg-inset px-3 font-mono text-xs text-ink focus:border-ring focus:outline-none"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="detail-mcp-cmd"
                      className="text-xs font-medium text-muted-ink"
                    >
                      Command
                    </label>
                    <input
                      id="detail-mcp-cmd"
                      type="text"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      className="h-9 w-full rounded-lg border border-control-border bg-inset px-3 font-mono text-xs text-ink focus:border-ring focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="detail-mcp-args"
                      className="text-xs font-medium text-muted-ink"
                    >
                      Arguments
                    </label>
                    <input
                      id="detail-mcp-args"
                      type="text"
                      value={argsText}
                      onChange={(e) => setArgsText(e.target.value)}
                      className="h-9 w-full rounded-lg border border-control-border bg-inset px-3 font-mono text-xs text-ink focus:border-ring focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="detail-mcp-env"
                  className="text-xs font-medium text-muted-ink"
                >
                  Environment variables (one{" "}
                  <code className="font-mono">KEY=VALUE</code> per line)
                </label>
                <textarea
                  id="detail-mcp-env"
                  rows={3}
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                  placeholder={
                    bp?.requiredEnv?.[0]
                      ? `${bp.requiredEnv[0].key}=${bp.requiredEnv[0].placeholder}`
                      : "API_KEY=..."
                  }
                  className="w-full rounded-lg border border-control-border bg-inset px-3 py-2 font-mono text-xs text-ink placeholder:text-muted-ink focus:border-ring focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-ink">
                  Live mcp.json entry preview
                </div>
                <pre className="overflow-x-auto rounded-xl border border-hairline bg-inset p-3.5 font-mono text-xs leading-relaxed text-body">
                  {jsonPreview}
                </pre>
              </div>

              {formError && <p className="text-xs text-danger">{formError}</p>}

              <div className="flex items-center justify-between gap-3 pt-1">
                {plugin.installed ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={saving}
                    onClick={() => void handleRemove()}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    <span>Uninstall server</span>
                  </Button>
                ) : (
                  <span />
                )}
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={saving}
                  className="rounded-full px-5"
                >
                  {saving ? "Saving..." : "Save to mcp.json"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
