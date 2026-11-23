import * as React from "react";
import { Cpu, Play, RotateCcw, X } from "lucide-react";

import { Badge, Button } from "@/components/ui";
import { callRpc, cn, useAppStore } from "@/lib";
import type { AppletStateView } from "@shared/vscodeProtocol";

export interface AppletRendererProps {
  applet: AppletStateView;
  sessionId?: string;
  onAction?: (
    appletId: string,
    action: string,
    payload?: Record<string, unknown>,
  ) => void;
  onClose?: (appletId: string) => void;
  className?: string;
}

export function AppletRenderer({
  applet,
  sessionId: sessionIdProp,
  onAction,
  onClose,
  className,
}: AppletRendererProps) {
  const storeSessionId = useAppStore((s) => s.activeSessionId);
  const sessionId = sessionIdProp ?? storeSessionId ?? "ses_vscode_shell";

  const [localState, setLocalState] = React.useState<Record<string, unknown>>(
    () => ({ ...applet.state }),
  );
  const [customActionInput, setCustomActionInput] = React.useState("");
  const [busyAction, setBusyAction] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLocalState({ ...applet.state });
  }, [applet.state]);

  const dispatchAction = async (
    action: string,
    payload?: Record<string, unknown>,
  ) => {
    setBusyAction(action);
    onAction?.(applet.appletId, action, payload);
    try {
      const res = await callRpc("inspector.applet.action", {
        sessionId,
        appletId: applet.appletId,
        action,
        payload,
      });
      if (res.applet) {
        setLocalState({ ...res.applet.state });
      }
    } catch {
      // ignore offline error
    } finally {
      setBusyAction(null);
    }
  };

  const handleClose = async () => {
    onClose?.(applet.appletId);
    try {
      await callRpc("inspector.applet.close", {
        sessionId,
        appletId: applet.appletId,
      });
    } catch {
      // ignore offline error
    }
  };

  const entries = Object.entries(localState);

  return (
    <div
      data-slot="applet-renderer"
      data-testid={`applet-renderer-${applet.appletId}`}
      className={cn(
        "rayu-card-bevel flex flex-col gap-3 overflow-hidden rounded-xl border border-premium bg-pane p-3.5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-hairline-soft pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-md border border-hairline bg-inset text-brand-text">
            <Cpu className="size-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-ink">
              {applet.title}
            </div>
            <div className="font-mono text-[10px] text-muted-ink">
              {applet.kind} · sandboxed applet
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Badge variant="brand" className="font-mono text-[10px]">
            Live
          </Badge>
          <button
            type="button"
            aria-label={`Close applet ${applet.title}`}
            data-testid={`applet-close-${applet.appletId}`}
            onClick={() => void handleClose()}
            className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Sandboxed state grid */}
      {entries.length === 0 ? (
        <div className="rounded-lg border border-hairline-soft bg-inset p-3 text-xs text-muted-ink">
          Applet mounted with empty state.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-1.5 rounded-lg border border-hairline-soft bg-inset p-2.5 text-xs">
          {entries.map(([key, val]) => (
            <div
              key={key}
              className="flex items-center justify-between gap-3 border-b border-hairline-soft/60 py-1 last:border-b-0"
            >
              <span className="font-mono text-[11px] text-muted-ink">{key}</span>
              <span className="truncate font-mono text-[11.5px] font-medium text-ink">
                {typeof val === "object" ? JSON.stringify(val) : String(val)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Interactive applet controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="primary"
          size="xs"
          disabled={busyAction !== null}
          data-testid={`applet-run-${applet.appletId}`}
          onClick={() => void dispatchAction("run", localState)}
        >
          <Play className="size-3" aria-hidden="true" />
          <span>Run Action</span>
        </Button>

        <Button
          type="button"
          variant="default"
          size="xs"
          disabled={busyAction !== null}
          data-testid={`applet-reset-${applet.appletId}`}
          onClick={() => void dispatchAction("reset")}
        >
          <RotateCcw className="size-3" aria-hidden="true" />
          <span>Reset</span>
        </Button>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!customActionInput.trim()) return;
            void dispatchAction("input", { value: customActionInput.trim() });
            setCustomActionInput("");
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5"
        >
          <input
            type="text"
            value={customActionInput}
            onChange={(e) => setCustomActionInput(e.target.value)}
            placeholder="Send payload..."
            className="h-6 min-w-0 flex-1 rounded-md border border-hairline bg-inset px-2 text-xs text-ink placeholder:text-faint focus:border-hairline-strong focus:outline-none"
          />
          <Button type="submit" variant="outline" size="xs">
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}
