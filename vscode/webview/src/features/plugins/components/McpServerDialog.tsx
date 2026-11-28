import * as React from "react";
import { Trash2 } from "lucide-react";
import type { McpTransport } from "@shared/vscodeProtocol";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Switch,
} from "@/components/ui";
import { cn } from "@/lib";

export interface McpServerDraft {
  mode: "add" | "edit";
  id: string;
  displayName: string;
  brandId?: string;
  scope: "global" | "workspace";
  workspacePath?: string;
  transport: McpTransport;
  command: string;
  argsText: string;
  url: string;
  envText: string;
  existingEnvKeys?: string[];
  shared: boolean;
  timeoutSecs: number;
  isInstalled?: boolean;
}

export interface McpServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDraft: McpServerDraft;
  onSave: (draft: {
    mode: "add" | "edit";
    id: string;
    name?: string;
    brandId?: string;
    scope: "global" | "workspace";
    workspacePath?: string;
    transport?: McpTransport;
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
    shared?: boolean;
    timeoutSecs?: number;
  }) => Promise<void>;
  onRemove?: (id: string, scope: "global" | "workspace", workspacePath?: string) => Promise<void>;
  isSaving?: boolean;
}

function parseEnvLines(
  raw: string,
  omitEmptyValues = false,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!key) continue;
    if (omitEmptyValues && !val) continue;
    env[key] = val;
  }
  return env;
}

export function McpServerDialog({
  open,
  onOpenChange,
  initialDraft,
  onSave,
  onRemove,
  isSaving = false,
}: McpServerDialogProps) {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  const [draft, setDraft] = React.useState<McpServerDraft>(initialDraft);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDraft(initialDraft);
    setErrorMessage(null);
  }, [initialDraft, open]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const cleanId = draft.id.trim();
    if (!cleanId) {
      setErrorMessage("Enter a server ID (e.g. github, linear, context7).");
      return;
    }

    const isEdit = draft.mode === "edit";
    const transportChanged = draft.transport !== initialDraft.transport;
    const commandChanged = draft.command.trim() !== initialDraft.command.trim();
    const urlChanged = draft.url.trim() !== initialDraft.url.trim();

    if (
      draft.transport === "stdio" &&
      !draft.command.trim() &&
      (!isEdit ||
        transportChanged ||
        commandChanged ||
        Boolean(initialDraft.command.trim()))
    ) {
      setErrorMessage("Enter the executable command for stdio transport.");
      return;
    }
    if (
      draft.transport !== "stdio" &&
      !draft.url.trim() &&
      (!isEdit ||
        transportChanged ||
        urlChanged ||
        Boolean(initialDraft.url.trim()))
    ) {
      setErrorMessage("Enter the remote server URL for HTTP/SSE transport.");
      return;
    }

    setErrorMessage(null);
    const args = draft.argsText.trim().split(/\s+/).filter(Boolean);
    const initialArgs = initialDraft.argsText
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const argsChanged = args.join(" ") !== initialArgs.join(" ");
    const sharedChanged = draft.shared !== initialDraft.shared;
    const timeoutChanged = draft.timeoutSecs !== initialDraft.timeoutSecs;
    const env = parseEnvLines(draft.envText, isEdit);

    try {
      if (isEdit) {
        await onSave({
          mode: "edit",
          id: cleanId,
          name: draft.displayName || cleanId,
          brandId: draft.brandId ?? cleanId,
          scope: draft.scope,
          workspacePath: draft.workspacePath,
          ...(transportChanged ? { transport: draft.transport } : {}),
          ...(draft.transport === "stdio" && commandChanged
            ? { command: draft.command.trim() }
            : {}),
          ...(draft.transport === "stdio" && argsChanged ? { args } : {}),
          ...(draft.transport !== "stdio" && urlChanged
            ? { url: draft.url.trim() }
            : {}),
          ...(Object.keys(env).length > 0 ? { env } : {}),
          ...(sharedChanged ? { shared: draft.shared } : {}),
          ...(timeoutChanged ? { timeoutSecs: draft.timeoutSecs } : {}),
        });
      } else {
        await onSave({
          mode: "add",
          id: cleanId,
          name: draft.displayName || cleanId,
          brandId: draft.brandId ?? cleanId,
          scope: draft.scope,
          workspacePath: draft.workspacePath,
          transport: draft.transport,
          ...(draft.transport === "stdio"
            ? { command: draft.command.trim(), args }
            : { url: draft.url.trim() }),
          ...(Object.keys(env).length > 0 ? { env } : {}),
          shared: draft.shared,
          timeoutSecs: draft.timeoutSecs,
        });
      }
      onOpenChange(false);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to save MCP server.",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="mcp-server-dialog"
        className="sm:max-w-[520px]"
      >
        <DialogHeader>
          <DialogTitle>
            {draft.mode === "edit"
              ? `Configure ${draft.displayName}`
              : `Add ${draft.displayName}`}
          </DialogTitle>
          <DialogDescription>
            Writes directly to{" "}
            <code className="font-mono text-xs text-body">
              {draft.scope === "workspace" ? ".mcp.json" : "~/.rayu/mcp.json"}
            </code>{" "}
            in the 7-layer Rust MCP discovery engine.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="min-w-0 space-y-3.5"
        >
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label
                htmlFor="mcp-dialog-id"
                className="text-xs font-medium text-muted-ink"
              >
                Server ID
              </label>
              <input
                id="mcp-dialog-id"
                data-testid="mcp-dialog-id-input"
                type="text"
                value={draft.id}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, id: e.target.value }))
                }
                placeholder="context7"
                className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 font-mono text-xs text-ink focus:border-ring focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-ink">
                Config Layer Scope
              </span>
              <div className="grid grid-cols-2 gap-1 rounded-md border border-hairline bg-inset p-0.5 text-xs">
                {(["global", "workspace"] as const).map((sc) => (
                  <button
                    key={sc}
                    type="button"
                    data-testid={`mcp-dialog-scope-${sc}`}
                    disabled={draft.mode === "edit"}
                    onClick={() =>
                      setDraft((prev) => ({ ...prev, scope: sc }))
                    }
                    className={cn(
                      "min-w-0 cursor-pointer truncate rounded px-1 py-1 text-center font-mono text-[11px] font-medium transition-colors",
                      draft.scope === sc
                        ? "bg-active text-ink"
                        : "text-muted-ink hover:text-ink",
                    )}
                  >
                    {sc === "global" ? "~/.rayu/mcp.json" : ".mcp.json"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-ink">
              Transport
            </span>
            <div className="grid grid-cols-3 gap-1 rounded-md border border-hairline bg-inset p-0.5 text-xs">
              {(["stdio", "streamable-http", "sse"] as const).map((tr) => (
                <button
                  key={tr}
                  type="button"
                  data-testid={`mcp-dialog-transport-${tr}`}
                  onClick={() =>
                    setDraft((prev) => ({ ...prev, transport: tr }))
                  }
                  className={cn(
                    "cursor-pointer rounded py-1 text-center font-mono text-[11px] font-medium transition-colors",
                    draft.transport === tr
                      ? "bg-active text-ink"
                      : "text-muted-ink hover:text-ink",
                  )}
                >
                  {tr}
                </button>
              ))}
            </div>
          </div>

          {draft.transport === "stdio" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[130px_minmax(0,1fr)]">
              <div className="space-y-1">
                <label
                  htmlFor="mcp-dialog-cmd"
                  className="text-xs font-medium text-muted-ink"
                >
                  Command
                </label>
                <input
                  id="mcp-dialog-cmd"
                  data-testid="mcp-dialog-command-input"
                  type="text"
                  value={draft.command}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, command: e.target.value }))
                  }
                  placeholder="npx"
                  className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 font-mono text-xs text-ink focus:border-ring focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="mcp-dialog-args"
                  className="text-xs font-medium text-muted-ink"
                >
                  Arguments
                </label>
                <input
                  id="mcp-dialog-args"
                  data-testid="mcp-dialog-args-input"
                  type="text"
                  value={draft.argsText}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, argsText: e.target.value }))
                  }
                  placeholder="-y @upstash/context7-mcp"
                  className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 font-mono text-xs text-ink focus:border-ring focus:outline-none"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <label
                htmlFor="mcp-dialog-url"
                className="text-xs font-medium text-muted-ink"
              >
                Remote Server URL
              </label>
              <input
                id="mcp-dialog-url"
                data-testid="mcp-dialog-url-input"
                type="url"
                value={draft.url}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, url: e.target.value }))
                }
                placeholder="https://mcp.linear.app/sse"
                className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 font-mono text-xs text-ink focus:border-ring focus:outline-none"
              />
            </div>
          )}

          <div className="space-y-1">
            <label
              htmlFor="mcp-dialog-env"
              className="text-xs font-medium text-muted-ink"
            >
              Environment variables (one{" "}
              <code className="font-mono">KEY=VALUE</code> per line)
            </label>
            {draft.mode === "edit" &&
              draft.existingEnvKeys &&
              draft.existingEnvKeys.length > 0 && (
                <div
                  data-testid="mcp-dialog-existing-env-keys"
                  className="flex flex-wrap items-center gap-1.5 pb-1 text-[11px] text-muted-ink"
                >
                  <span>Existing keys kept unless overridden</span>
                  {draft.existingEnvKeys.map((key) => (
                    <code
                      key={key}
                      className="rounded border border-hairline bg-inset px-1.5 py-0.5 font-mono text-[10.5px] text-body"
                    >
                      {key}
                    </code>
                  ))}
                </div>
              )}
            <textarea
              id="mcp-dialog-env"
              data-testid="mcp-dialog-env-input"
              rows={2}
              value={draft.envText}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, envText: e.target.value }))
              }
              placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=ghp_..."
              className="w-full rounded-md border border-control-border bg-inset px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-muted-ink focus:border-ring focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hairline bg-inset px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <Switch
                size="sm"
                checked={draft.shared}
                onCheckedChange={(checked) =>
                  setDraft((prev) => ({ ...prev, shared: checked }))
                }
                aria-label="Shared process pool"
                data-testid="mcp-dialog-shared-switch"
              />
              <span className="text-body">
                Shared Process Pool ({draft.shared ? "shared" : "per-session"})
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <label htmlFor="mcp-dialog-timeout" className="text-muted-ink">
                Timeout (s):
              </label>
              <input
                id="mcp-dialog-timeout"
                type="number"
                min={5}
                max={300}
                value={draft.timeoutSecs}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    timeoutSecs: Number(e.target.value) || 30,
                  }))
                }
                className="h-6 w-14 rounded border border-control-border bg-pane px-1.5 font-mono text-xs text-ink tabular-nums"
              />
            </div>
          </div>

          {errorMessage && (
            <p
              role="alert"
              data-testid="mcp-dialog-error"
              className="text-xs text-danger"
            >
              {errorMessage}
            </p>
          )}

          <DialogFooter className="flex items-center justify-between gap-2">
            {draft.isInstalled && onRemove ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={isSaving}
                data-testid="mcp-dialog-remove-btn"
                onClick={() => {
                  void onRemove(draft.id, draft.scope, draft.workspacePath)
                    .then(() => onOpenChange(false))
                    .catch((err) =>
                      setErrorMessage(
                        err instanceof Error
                          ? err.message
                          : "Failed to remove MCP server.",
                      ),
                    );
                }}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                <span>Remove</span>
              </Button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={isSaving}
                data-testid="mcp-dialog-save-btn"
              >
                {isSaving ? "Saving..." : "Save Server"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
