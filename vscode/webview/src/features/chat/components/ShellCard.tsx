import * as React from "react";
import {
  Check,
  ChevronRight,
  Copy,
  Layers,
  LayoutGrid,
  MoreHorizontal,
  Terminal,
  X,
} from "lucide-react";

import {
  callRpc,
  cn,
  postToHost,
  useAppStore,
  type ShellCommandStep,
} from "@/lib";

import { ChatSessionContext } from "./ChatSessionContext";

export interface ShellCardProps {
  step: ShellCommandStep;
  sessionId?: string;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onMoveToBackground?: (step: ShellCommandStep) => void;
  showMoveToBackground?: boolean;
  standalone?: boolean;
  className?: string;
}

export function ShellCard({
  step,
  sessionId,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onExpandedChange,
  onMoveToBackground,
  showMoveToBackground = true,
  standalone = false,
  className,
}: ShellCardProps) {
  const contextSessionId = React.useContext(ChatSessionContext);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const explicitSessionId =
    sessionId ?? contextSessionId ?? activeSessionId ?? undefined;
  const resolvedSessionId = explicitSessionId ?? "ses_vscode_shell";

  const [uncontrolledExpanded, setUncontrolledExpanded] = React.useState(
    standalone || defaultExpanded,
  );
  const [copied, setCopied] = React.useState(false);
  const [backgrounded, setBackgrounded] = React.useState(false);
  const [showFullOutput, setShowFullOutput] = React.useState(false);
  const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const isControlled = controlledExpanded !== undefined;
  const isExpanded = standalone
    ? true
    : isControlled
      ? controlledExpanded
      : uncontrolledExpanded;

  const isFailed = Boolean(step.isFailed) || step.exitCode !== 0;
  const trimmedCmd = step.command.trim();
  const isJsonLikeCommand =
    (trimmedCmd.startsWith("{") && trimmedCmd.endsWith("}")) ||
    (trimmedCmd.startsWith("[") && trimmedCmd.endsWith("]"));
  const isPlaintextTool =
    step.isMono === false ||
    isJsonLikeCommand ||
    step.displayCommand.toLowerCase().startsWith("importing ") ||
    step.displayCommand.toLowerCase().startsWith("inspecting ");
  const cardId = `shell-card-${step.id}`;

  React.useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleToggle = () => {
    const next = !isExpanded;
    if (!isControlled) {
      setUncontrolledExpanded(next);
    }
    onExpandedChange?.(next);
  };

  const handleCopy = async () => {
    const payload = step.output
      ? `$ ${step.command}\n${step.output}`
      : step.command;
    postToHost({ type: "rayucode.editor.copy", text: payload });
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      }
    } catch {
      // ignore clipboard permission errors in restricted contexts
    }
    setCopied(true);
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => {
      setCopied(false);
      copyTimerRef.current = null;
    }, 1500);
  };

  const handleMoveToBackground = async () => {
    setBackgrounded(true);
    onMoveToBackground?.(step);
    try {
      await callRpc("background.backgroundTool", {
        sessionId: resolvedSessionId,
      });
    } catch {
      // ignore mock/disconnected errors
    }
  };

  const cardBody = (
    <div
      id={cardId}
      data-slot="shell-card"
      data-testid={`shell-card-${step.id}`}
      className={cn(
        "my-1 overflow-hidden rounded-[12px] border border-hairline bg-inset shadow-bevel-surface",
        standalone && className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline-soft px-3.5 py-2 text-[11.5px] font-medium text-muted-ink">
        <div className="flex items-center gap-2">
          <span>{isPlaintextTool ? (step.toolName ?? "Tool") : "Shell"}</span>
          {step.intent && step.intent !== step.displayCommand && (
            <span className="truncate text-[11px] text-faint">
              · {step.intent}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!isPlaintextTool && (
            <button
              type="button"
              data-testid={`shell-open-terminal-${step.id}`}
              onClick={() =>
                postToHost({
                  type: "rayucode.editor.openTerminal",
                  sessionId: explicitSessionId,
                  cwd: explicitSessionId
                    ? undefined
                    : (activeProjectPath ?? undefined),
                })
              }
              title="Open VS Code Integrated Terminal"
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-hairline bg-pane px-2 py-0.5 text-[11px] font-medium text-muted-ink transition-colors hover:border-premium hover:bg-hover hover:text-ink"
            >
              <Terminal className="size-3 shrink-0" aria-hidden="true" />
              <span>Terminal</span>
            </button>
          )}

          {showMoveToBackground && !isPlaintextTool && (
            <button
              type="button"
              data-testid={`shell-move-to-bg-${step.id}`}
              onClick={() => void handleMoveToBackground()}
              title="Move command to Background Process Viewer (Alt+B)"
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-md border border-hairline bg-pane px-2 py-0.5 text-[11px] font-medium transition-colors hover:border-premium hover:bg-hover hover:text-ink",
                backgrounded ? "text-brand-text" : "text-muted-ink",
              )}
            >
              <Layers className="size-3 shrink-0" aria-hidden="true" />
              <span>
                {backgrounded ? "Moved to Background" : "Move to Background"}
              </span>
              <kbd className="ml-0.5 rounded bg-active px-1 py-0.2 font-mono text-[9.5px] text-faint">
                Alt+B
              </kbd>
            </button>
          )}

          <span
            data-slot="shell-status"
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
              isFailed ? "text-danger" : "text-brand-text",
            )}
          >
            {isFailed ? (
              <X className="size-3 shrink-0" aria-hidden="true" />
            ) : (
              <Check className="size-3 shrink-0" aria-hidden="true" />
            )}
            <span>{step.statusLabel}</span>
          </span>

          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label="Copy command"
            title="Copy command"
            className={cn(
              "grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              copied && "text-brand-text",
            )}
          >
            {copied ? (
              <Check className="size-3.5" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {!isPlaintextTool ? (
        <div className="break-words px-3.5 pt-2 pb-1.5 font-mono text-[12.2px] leading-relaxed text-ink">
          $ {step.command}
        </div>
      ) : null}

      {step.output && (
        <div className="relative">
          <pre
            className={cn(
              "m-0 overflow-auto px-3.5 pt-2 pb-3 font-mono text-xs leading-[1.55] whitespace-pre text-body tabular-nums",
              !showFullOutput && "max-h-[210px]",
            )}
          >
            {step.output}
          </pre>
          {step.output.split("\n").length > 8 ? (
            <button
              type="button"
              aria-label="Toggle full tool output"
              onClick={() => setShowFullOutput((prev) => !prev)}
              className="absolute right-3 bottom-2.5 inline-flex size-6 cursor-pointer items-center justify-center rounded-full border border-hairline bg-raised text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              <MoreHorizontal className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      )}
    </div>
  );

  if (standalone) {
    return cardBody;
  }

  const useMonoRow = !isFailed && !isPlaintextTool;
  const RowIcon = isPlaintextTool ? LayoutGrid : Terminal;

  return (
    <div
      data-slot="shell-command-row"
      className={cn("flex flex-col", className)}
    >
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={cardId}
        onClick={handleToggle}
        className={cn(
          "-ml-2 inline-flex max-w-full cursor-pointer items-center gap-2 self-start rounded-[9px] border border-transparent px-2.5 py-1 text-left text-[13px] leading-[1.4] text-muted-ink transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isExpanded && "border-hairline bg-inset text-ink",
        )}
      >
        <RowIcon
          className="size-3.5 shrink-0 text-muted-ink"
          aria-hidden="true"
        />
        <span
          className={cn(
            "min-w-0 truncate",
            useMonoRow ? "font-mono text-[12.2px]" : "font-sans",
            isFailed && !isExpanded && "text-danger",
          )}
        >
          {useMonoRow ? `$ ${step.displayCommand}` : step.displayCommand}
        </span>
        <ChevronRight
          className={cn(
            "ml-0.5 size-3 shrink-0 text-muted-ink transition-transform duration-150",
            isExpanded && "rotate-90 text-ink",
          )}
          aria-hidden="true"
        />
      </button>

      {isExpanded && cardBody}
    </div>
  );
}
