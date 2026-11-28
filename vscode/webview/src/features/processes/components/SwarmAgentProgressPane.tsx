import * as React from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  FileCode2,
  Loader2,
  MessageSquare,
  Network,
  Pause,
  Play,
  RefreshCw,
  Send,
  Square,
  XCircle,
} from "lucide-react";
import type { SwarmAgentView } from "@shared/vscodeProtocol";

import { Badge, Button, Input, RayuProcessingMark } from "@/components/ui";
import { cn, formatDurationSeconds, operationAvailable } from "@/lib";

export interface SwarmAgentProgressPaneProps {
  agent: SwarmAgentView;
  swarmLabel?: string;
  isRefreshing?: boolean;
  onRefresh: () => void;
  onOpenChat: (sessionId: string, label: string) => void;
  onOpenSwarmView: () => void;
  onOpenFile: (path: string) => void;
  onStopAgent: (agentId: string) => Promise<void> | void;
  onResumeAgent: (agentId: string) => Promise<void> | void;
  onSendDm: (agentId: string, message: string) => Promise<void> | void;
  className?: string;
}

export function isSwarmAgentActive(status: SwarmAgentView["status"]): boolean {
  return status === "running" || status === "spawned" || status === "blocked";
}

export function computeSwarmAgentPercent(agent: SwarmAgentView): number | null {
  if (
    typeof agent.todoCompleted === "number" &&
    typeof agent.todoTotal === "number" &&
    agent.todoTotal > 0
  ) {
    return Math.max(
      0,
      Math.min(100, Math.round((agent.todoCompleted / agent.todoTotal) * 100)),
    );
  }
  if (agent.status === "completed") return 100;
  return null;
}

function formatTokenShort(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(Math.round(tokens));
}

export function SwarmAgentProgressPane({
  agent,
  swarmLabel,
  isRefreshing = false,
  onRefresh,
  onOpenChat,
  onOpenSwarmView,
  onOpenFile,
  onStopAgent,
  onResumeAgent,
  onSendDm,
  className,
}: SwarmAgentProgressPaneProps) {
  const [dmText, setDmText] = React.useState("");
  const [sendingDm, setSendingDm] = React.useState(false);
  const [togglingState, setTogglingState] = React.useState(false);

  const active = isSwarmAgentActive(agent.status);
  const percent = computeSwarmAgentPercent(agent);
  const canControl = operationAvailable("swarm.kill");
  const canDm = operationAvailable("swarm.dm");
  const canResume =
    agent.status === "stopped" ||
    agent.status === "blocked" ||
    agent.status === "ready";
  const outputText = agent.outputTail || agent.latestCompletionReport || "";

  const handleToggleAgent = async () => {
    setTogglingState(true);
    try {
      const target = agent.sessionId || agent.agentId;
      if (canResume && !active) {
        await onResumeAgent(target);
      } else {
        await onStopAgent(target);
      }
    } finally {
      setTogglingState(false);
    }
  };

  const handleDmSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = dmText.trim();
    if (!trimmed || sendingDm) return;
    setSendingDm(true);
    try {
      await onSendDm(agent.sessionId || agent.agentId, trimmed);
      setDmText("");
    } finally {
      setSendingDm(false);
    }
  };

  const renderStatusBadge = () => {
    switch (agent.status) {
      case "running":
      case "spawned":
        return (
          <Badge variant="brand" className="h-5 gap-1 px-2 text-[10px]">
            <RayuProcessingMark animated className="size-2.5" />
            <span>{agent.status === "spawned" ? "Starting" : "Running"}</span>
          </Badge>
        );
      case "blocked":
        return (
          <Badge variant="warn" className="h-5 gap-1 px-2 text-[10px]">
            <AlertTriangle className="size-2.5 text-warn" />
            <span>Blocked</span>
          </Badge>
        );
      case "completed":
        return (
          <Badge variant="secondary" className="h-5 gap-1 px-2 text-[10px]">
            <Check className="size-2.5 text-brand-text" />
            <span>Completed</span>
          </Badge>
        );
      case "failed":
      case "crashed":
        return (
          <Badge variant="danger" className="h-5 gap-1 px-2 text-[10px]">
            <XCircle className="size-2.5" />
            <span>{agent.status === "crashed" ? "Crashed" : "Failed"}</span>
          </Badge>
        );
      case "stopped":
        return (
          <Badge variant="outline" className="h-5 gap-1 px-2 text-[10px]">
            <Pause className="size-2.5" />
            <span>Stopped</span>
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="h-5 gap-1 px-2 text-[10px]">
            <Clock className="size-2.5" />
            <span>Ready</span>
          </Badge>
        );
    }
  };

  return (
    <div
      data-slot="swarm-agent-progress-pane"
      data-testid="swarm-agent-progress-pane"
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[10px] border border-hairline bg-canvas",
        className,
      )}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-pane/70 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-info-soft text-info">
            <Network className="size-3.5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-mono text-xs font-semibold text-ink">
                {agent.label}
              </span>
              <Badge
                variant="outline"
                className="h-4 px-1.5 text-[10px] font-normal text-muted-ink capitalize"
              >
                {agent.role}
              </Badge>
              {renderStatusBadge()}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-muted-ink tabular-nums">
              {swarmLabel && <span className="truncate">{swarmLabel}</span>}
              {agent.model && (
                <span className="truncate font-mono">{agent.model}</span>
              )}
              {typeof agent.elapsedSecs === "number" && (
                <span>{formatDurationSeconds(agent.elapsedSecs)}</span>
              )}
              {typeof agent.contextTokens === "number" &&
                typeof agent.contextLimit === "number" &&
                agent.contextLimit > 0 && (
                  <span>
                    {formatTokenShort(agent.contextTokens)} /{" "}
                    {formatTokenShort(agent.contextLimit)} ctx
                  </span>
                )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {agent.sessionId && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              data-testid="swarm-pane-open-chat"
              onClick={() => onOpenChat(agent.sessionId, agent.label)}
            >
              <MessageSquare className="size-3" />
              <span>Open Chat</span>
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="xs"
            data-testid="swarm-pane-open-mission"
            onClick={onOpenSwarmView}
          >
            <ExternalLink className="size-3" />
            <span>Swarm</span>
          </Button>
          {canControl && agent.role !== "coordinator" && (active || canResume) && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={togglingState}
              data-testid="swarm-pane-toggle-agent"
              onClick={() => void handleToggleAgent()}
              className={cn(
                active &&
                  "text-danger hover:border-danger/40 hover:bg-danger-soft",
              )}
            >
              {active ? (
                <>
                  <Square className="size-2.5 fill-current" />
                  <span>Stop</span>
                </>
              ) : (
                <>
                  <Play className="size-2.5 fill-current" />
                  <span>Resume</span>
                </>
              )}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={isRefreshing}
            aria-label="Refresh swarm status"
            onClick={onRefresh}
          >
            <RefreshCw
              className={cn("size-3", isRefreshing && "motion-safe:animate-spin")}
            />
          </Button>
        </div>
      </div>

      {/* Wait / Blocked alert */}
      {agent.waitReason && (
        <div
          role="status"
          aria-live="polite"
          data-testid="swarm-pane-wait-banner"
          className="flex items-center gap-2 border-b border-warn/30 bg-warn-soft px-3 py-1.5 text-[11px] text-warn"
        >
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{agent.waitReason}</span>
        </div>
      )}

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {/* Current task & progress bar */}
        <section className="flex flex-col gap-1.5 rounded-[8px] border border-hairline bg-pane/60 p-2.5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="font-medium text-ink">
              {agent.liveStatus || (active ? "Active progress" : "Task summary")}
            </span>
            <span className="font-mono text-[10.5px] text-muted-ink tabular-nums">
              {typeof agent.todoCompleted === "number" &&
              typeof agent.todoTotal === "number" &&
              agent.todoTotal > 0
                ? `${agent.todoCompleted}/${agent.todoTotal} todos (${percent ?? 0}%)`
                : percent !== null
                  ? `${percent}%`
                  : agent.status}
            </span>
          </div>

          {(agent.currentIntent || agent.taskLabel) && (
            <p className="text-xs leading-relaxed text-body">
              {agent.currentIntent || agent.taskLabel}
            </p>
          )}

          {percent !== null ? (
            <div
              role="progressbar"
              aria-label={`${agent.label} progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="h-1.5 w-full overflow-hidden rounded-full bg-inset"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300",
                  agent.status === "failed" || agent.status === "crashed"
                    ? "bg-danger"
                    : agent.status === "blocked"
                      ? "bg-warn"
                      : "bg-brand",
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
          ) : active ? (
            <div
              role="progressbar"
              aria-label={`${agent.label} running`}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 w-full overflow-hidden rounded-full bg-inset"
            >
              <div className="h-full w-1/3 rounded-full bg-brand/75 motion-safe:animate-pulse" />
            </div>
          ) : null}
        </section>

        {/* Live Output Tail / Latest Completion Report */}
        <section className="flex min-h-[96px] flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-semibold tracking-wider text-muted-ink uppercase">
              {agent.outputTail ? "Live Output Tail" : "Latest Report"}
            </span>
            {typeof agent.activityAgeSecs === "number" && active && (
              <span className="font-mono text-[10px] text-faint tabular-nums">
                Last activity {formatDurationSeconds(agent.activityAgeSecs)} ago
              </span>
            )}
          </div>
          <div
            data-testid="swarm-pane-output-tail"
            className="max-h-[180px] overflow-y-auto rounded-[8px] border border-hairline bg-inset p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-body"
          >
            {outputText ||
              (active
                ? "Worker is running — waiting for streamed output..."
                : "No output captured for this worker yet.")}
          </div>
        </section>

        {/* Todo Items (real Rust todo_items) */}
        {agent.todoItems && agent.todoItems.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-semibold tracking-wider text-muted-ink uppercase">
              Worker Todos
            </span>
            <ul className="flex flex-col gap-1 rounded-[8px] border border-hairline bg-pane/40 p-2">
              {agent.todoItems.map((todo, idx) => {
                const st = todo.status.toLowerCase();
                const done = st === "completed";
                const inProg = st === "in_progress";
                return (
                  <li
                    key={`${todo.content}-${idx}`}
                    className="flex items-start gap-2 text-xs"
                  >
                    {done ? (
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-brand-text" />
                    ) : inProg ? (
                      <Loader2 className="mt-0.5 size-3.5 shrink-0 text-info motion-safe:animate-spin" />
                    ) : (
                      <Circle className="mt-0.5 size-3.5 shrink-0 text-faint" />
                    )}
                    <span
                      className={cn(
                        "min-w-0 flex-1 leading-snug",
                        done ? "text-muted-ink line-through" : "text-ink",
                      )}
                    >
                      {todo.content}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Files Touched (real Rust files_touched) */}
        {agent.filesTouched && agent.filesTouched.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-semibold tracking-wider text-muted-ink uppercase">
              Files Touched ({agent.filesTouched.length})
            </span>
            <div className="flex flex-wrap gap-1">
              {agent.filesTouched.map((filePath) => (
                <button
                  key={filePath}
                  type="button"
                  onClick={() => onOpenFile(filePath)}
                  className="inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md border border-hairline bg-pane px-2 py-0.5 font-mono text-[10.5px] text-body transition-colors hover:border-premium hover:bg-hover hover:text-ink"
                >
                  <FileCode2 className="size-3 shrink-0 text-muted-ink" />
                  <span className="truncate">{filePath}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Inline DM steering bar */}
      {canDm && agent.role !== "coordinator" && (
        <form
          onSubmit={(event) => void handleDmSubmit(event)}
          className="flex items-center gap-1.5 border-t border-hairline bg-pane/70 px-2.5 py-2"
        >
          <Input
            type="text"
            value={dmText}
            onChange={(event) => setDmText(event.target.value)}
            placeholder={`Steer ${agent.label} with a direct message...`}
            data-testid="swarm-pane-dm-input"
            className="h-7 flex-1 text-xs"
          />
          <Button
            type="submit"
            size="xs"
            variant="secondary"
            disabled={!dmText.trim() || sendingDm}
            data-testid="swarm-pane-dm-send"
          >
            <Send className="size-3" />
            <span>Send</span>
          </Button>
        </form>
      )}
    </div>
  );
}
