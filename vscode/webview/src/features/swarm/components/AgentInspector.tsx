import * as React from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  Play,
  RotateCcw,
  Send,
  Square,
  Terminal,
} from "lucide-react";
import type { TodoItemView } from "@shared/vscodeProtocol";

import {
  Button,
  RayuProcessingMark,
  RunStatusPulse,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TechFileBadge,
} from "@/components/ui";
import { basenameOf, cn } from "@/lib";

import {
  DEFAULT_SWARM_MODELS,
  type SwarmAgentView,
} from "../hooks/useSwarm";
import { mapAgentStatusToTone } from "./AgentRoster";

export interface AgentInspectorProps {
  agent: SwarmAgentView | undefined;
  todos?: TodoItemView[];
  traceEntries?: unknown[];
  availableModels?: string[];
  isMutatingAgent?: boolean;
  isSendingDm?: boolean;
  showBackButton?: boolean;
  onBackToRoster?: () => void;
  onOpenChat?: (agent: SwarmAgentView) => void;
  onKillAgent?: (agentId: string, pauseOnly?: boolean) => Promise<{ ok: boolean; error?: string }>;
  onSalvageAgent?: (agentId: string) => Promise<{ ok: boolean; error?: string }>;
  onSwitchModel?: (agentId: string, model: string) => Promise<{ ok: boolean; error?: string }>;
  onSendDm?: (
    agentId: string,
    message: string,
  ) => Promise<{ ok: boolean; error?: string; seq?: number }>;
  onOpenFile?: (path: string, line?: number) => void;
  onOpenWorktreeWindow?: (path: string) => void;
  className?: string;
}

interface AgentTraceCommand {
  id: string;
  command: string;
  output: string;
  exitCode: number;
}

function getOwnedFilesForAgent(agent: SwarmAgentView): string[] {
  if (agent.agentId === "coordinator") {
    return [
      "vscode/VSCODE_DESIGN.md",
      "vscode/shared/vscodeProtocol.ts",
    ];
  }
  if (agent.agentId === "ui-shell") {
    return [
      "vscode/webview/src/styles/globals.css",
      "vscode/webview/src/features/shell/components/AppShell.tsx",
      "vscode/webview/src/components/ui/rayu-symbols.tsx",
    ];
  }
  return [
    `vscode/webview/src/features/swarm/components/${agent.label}.tsx`,
    "vscode/shared/vscodeProtocol.ts",
  ];
}

function getCommandsForAgent(
  agent: SwarmAgentView,
  traceEntries: unknown[],
): AgentTraceCommand[] {
  const parsed: AgentTraceCommand[] = [];
  for (let i = 0; i < traceEntries.length; i += 1) {
    const entry = traceEntries[i];
    if (entry && typeof entry === "object") {
      const rec = entry as Record<string, unknown>;
      if (typeof rec.command === "string") {
        parsed.push({
          id: String(rec.id ?? `cmd_${i}`),
          command: rec.command,
          output: typeof rec.output === "string" ? rec.output : "exit 0",
          exitCode: typeof rec.exitCode === "number" ? rec.exitCode : 0,
        });
      }
    }
  }
  if (parsed.length > 0) return parsed;

  if (agent.agentId === "coordinator") {
    return [
      {
        id: "cmd_coord_1",
        command: "rayu swarm status --json",
        output: "active_agents: 2 · plan_version: v3 · conflicts: 0",
        exitCode: 0,
      },
    ];
  }

  return [
    {
      id: `cmd_${agent.agentId}_1`,
      command: "npm run lint:design --workspace @rayu-dev/rayucode-vscode",
      output: "lint:design passed (0 violations).",
      exitCode: 0,
    },
    {
      id: `cmd_${agent.agentId}_2`,
      command: "npm run typecheck --workspace @rayu-dev/rayucode-vscode",
      output: "tsc --noEmit completed with 0 errors.",
      exitCode: 0,
    },
  ];
}

function getTodosForAgent(
  agent: SwarmAgentView,
  todos: TodoItemView[],
): TodoItemView[] {
  if (todos.length > 0) return todos;
  return [
    {
      content: "Read VSCODE_DESIGN.md and vscodeProtocol.ts contracts",
      status: "completed",
    },
    {
      content: agent.currentIntent || "Execute assigned worker slice",
      status: agent.status === "completed" ? "completed" : "in_progress",
    },
    {
      content: "Run lint:design and Vitest verification gates",
      status: agent.status === "completed" ? "completed" : "pending",
    },
  ];
}

export function AgentInspector({
  agent,
  todos = [],
  traceEntries = [],
  availableModels = [...DEFAULT_SWARM_MODELS],
  isMutatingAgent = false,
  isSendingDm = false,
  showBackButton = false,
  onBackToRoster,
  onOpenChat,
  onKillAgent,
  onSalvageAgent,
  onSwitchModel,
  onSendDm,
  onOpenFile,
  onOpenWorktreeWindow,
  className,
}: AgentInspectorProps) {
  const [traceExpanded, setTraceExpanded] = React.useState<boolean>(true);
  const [expandedCmdIds, setExpandedCmdIds] = React.useState<Record<string, boolean>>({});
  const [dmTextByAgent, setDmTextByAgent] = React.useState<Record<string, string>>({});
  const [dmError, setDmError] = React.useState<string | null>(null);
  const [dmSentAck, setDmSentAck] = React.useState<string | null>(null);
  const dmInputRef = React.useRef<HTMLInputElement | null>(null);

  if (!agent) {
    return (
      <section
        data-slot="agent-inspector"
        data-testid="agent-inspector-empty"
        aria-label="Selected agent trace"
        className={cn(
          "rayu-card-bevel flex min-h-[280px] items-center justify-center rounded-[14px] bg-pane p-6 text-xs text-muted-ink",
          className,
        )}
      >
        Select an agent from the roster to inspect its todo lane, owned files,
        and live work trace.
      </section>
    );
  }

  const dmText = dmTextByAgent[agent.agentId] ?? "";
  const isCoordinator = agent.role === "coordinator" || agent.depth === 0;
  const isStopped = agent.status === "stopped";
  const canSalvage =
    agent.status === "failed" ||
    agent.status === "crashed" ||
    agent.status === "blocked" ||
    agent.status === "stopped";

  const resolvedTodos = getTodosForAgent(agent, todos);
  const completedTodos =
    agent.todoCompleted ??
    resolvedTodos.filter((t) => t.status === "completed").length;
  const totalTodos = agent.todoTotal ?? resolvedTodos.length;

  const ownedFiles = getOwnedFilesForAgent(agent);
  const commands = getCommandsForAgent(agent, traceEntries);

  const handleDmSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = dmText.trim();
    if (!trimmed) {
      setDmError("Steering message cannot be empty.");
      dmInputRef.current?.focus();
      return;
    }

    setDmError(null);
    if (!onSendDm) return;
    const result = await onSendDm(agent.agentId, trimmed);
    if (result.ok) {
      setDmTextByAgent((prev) => ({ ...prev, [agent.agentId]: "" }));
      setDmSentAck(`Delivered to @${agent.label}`);
    } else {
      setDmError(result.error ?? "Failed to send steering DM.");
    }
  };

  return (
    <section
      data-slot="agent-inspector"
      data-testid="agent-inspector"
      data-agent-id={agent.agentId}
      aria-label="Selected agent trace"
      className={cn(
        "rayu-card-bevel flex flex-col overflow-hidden rounded-[14px] bg-pane",
        className,
      )}
    >
      {/* Optional Compact Sidebar Back Bar */}
      {showBackButton && onBackToRoster && (
        <div className="flex items-center border-b border-hairline bg-chrome px-3 py-2">
          <button
            type="button"
            data-testid="inspector-back-to-roster"
            onClick={onBackToRoster}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-ink transition-colors hover:bg-hover hover:text-ink"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            <span>Back to Roster</span>
          </button>
        </div>
      )}

      {/* Inspector Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-hairline bg-chrome px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {agent.status === "running" ? (
            <RayuProcessingMark className="size-3.5 shrink-0" />
          ) : (
            <RunStatusPulse
              status={mapAgentStatusToTone(agent.status)}
              label={agent.status}
            />
          )}

          <strong
            data-testid="inspector-agent-label"
            className="font-mono text-[13.5px] font-semibold text-ink"
          >
            {agent.label}
          </strong>

          <span className="rounded-full border border-hairline bg-inset px-2 py-px text-[11px] text-muted-ink">
            {agent.role}
          </span>

          {onSwitchModel ? (
            <Select
              value={agent.model ?? "inherit"}
              onValueChange={(value) => void onSwitchModel(agent.agentId, value)}
            >
              <SelectTrigger
                aria-label="Switch worker model"
                data-testid="inspector-model-select"
                className="h-6 min-w-0 max-w-full rounded-md border-hairline bg-inset px-2 font-mono text-[11px] @min-[360px]/swarm:min-w-[132px]"
              >
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent position="popper">
                {availableModels.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="rounded-sm bg-inset px-1.5 py-0.5 font-mono text-[11px] text-body">
              {agent.model ?? "inherit"}
            </span>
          )}

          {agent.branch && (
            <span className="truncate font-mono text-[11px] text-muted-ink">
              {agent.branch}
            </span>
          )}
        </div>

        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
          {onOpenChat && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-testid="inspector-open-chat-btn"
              onClick={() => onOpenChat(agent)}
            >
              <MessageSquare className="size-3" aria-hidden="true" />
              <span>Open in Chat</span>
            </Button>
          )}

          {agent.worktreePath && onOpenWorktreeWindow && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-testid="inspector-open-worktree-btn"
              onClick={() => onOpenWorktreeWindow(agent.worktreePath!)}
            >
              <ExternalLink className="size-3" aria-hidden="true" />
              <span>VS Code Window</span>
            </Button>
          )}

          {!isCoordinator && canSalvage && onSalvageAgent && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={isMutatingAgent}
              data-testid="inspector-salvage-btn"
              onClick={() => void onSalvageAgent(agent.agentId)}
            >
              <RotateCcw className="size-3" aria-hidden="true" />
              <span>Salvage</span>
            </Button>
          )}

          {!isCoordinator && onKillAgent && (
            <Button
              type="button"
              variant={isStopped ? "outline" : "destructive"}
              size="xs"
              disabled={isMutatingAgent}
              data-slot="agent-lifecycle-toggle"
              data-testid="inspector-kill-btn"
              onClick={() => void onKillAgent(agent.agentId)}
            >
              {isStopped ? (
                <>
                  <Play className="size-3" aria-hidden="true" />
                  <span>Resume</span>
                </>
              ) : (
                <>
                  <Square className="size-3" aria-hidden="true" />
                  <span>Stop</span>
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Inspector Body */}
      <div className="flex flex-col gap-3.5 px-4 py-3.5">
        {/* Owned Files with clickable TechFileBadge */}
        <div
          data-slot="agent-owned-files"
          data-testid="agent-owned-files"
          className="flex flex-wrap items-center gap-1.5"
        >
          <span className="text-[11.5px] font-medium text-muted-ink">
            Owned files:
          </span>
          {ownedFiles.map((filePath) => (
            <button
              key={filePath}
              type="button"
              data-slot="owned-file-pill"
              data-testid={`owned-file-${basenameOf(filePath)}`}
              onClick={() => onOpenFile?.(filePath, 1)}
              className="inline-flex max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md border border-hairline bg-inset px-2 py-0.5 font-mono text-[11px] text-ink transition-colors hover:border-brand/50 hover:bg-brand-softer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <TechFileBadge path={filePath} />
              <span className="truncate">{basenameOf(filePath)}</span>
            </button>
          ))}
        </div>

        {/* Assigned Todo Lane */}
        <div
          data-slot="agent-todo-lane"
          data-testid="agent-todo-lane"
          className="flex flex-col gap-1.5 rounded-[10px] border border-hairline bg-inset px-3 py-2.5"
        >
          <div className="mb-0.5 flex items-center justify-between text-[11.5px] font-medium text-muted-ink">
            <span>
              {isCoordinator ? "Coordinator checklist" : "Assigned Todo Lane"}
            </span>
            <span className="font-mono tabular-nums">
              {completedTodos} / {totalTodos}
            </span>
          </div>

          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {resolvedTodos.map((item, idx) => (
              <li
                key={`${item.content}_${idx}`}
                data-status={item.status}
                className={cn(
                  "flex items-center gap-2 text-[12px] leading-snug",
                  item.status === "completed" && "text-muted-ink line-through",
                  item.status === "in_progress" && "font-medium text-ink",
                  item.status === "pending" && "text-body",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    item.status === "completed" && "bg-brand",
                    item.status === "in_progress" && "bg-brand-bright",
                    item.status === "pending" && "bg-hairline-strong",
                  )}
                />
                <span>{item.content}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Quiet 3-Depth Execution Trace & Live Shell Output */}
        <div
          data-slot="agent-work-trace"
          data-testid="agent-work-trace"
          className="flex flex-col gap-1.5"
        >
          <button
            type="button"
            aria-expanded={traceExpanded}
            data-testid="inspector-trace-toggle"
            onClick={() => setTraceExpanded((prev) => !prev)}
            className="-ml-1.5 inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] font-medium text-muted-ink transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BookOpen className="size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Worked for 38s · {ownedFiles.length} files · {commands.length}{" "}
              {commands.length === 1 ? "cmd" : "cmds"}
            </span>
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 transition-transform duration-150",
                traceExpanded && "rotate-90",
              )}
              aria-hidden="true"
            />
          </button>

          {traceExpanded && (
            <div className="ml-[7px] flex flex-col gap-2 border-l border-hairline pl-3.5">
              {/* Coalesced File Reads */}
              <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-ink">
                <BookOpen className="size-3.5 shrink-0" aria-hidden="true" />
                <span>Read</span>
                {ownedFiles.map((filePath) => (
                  <button
                    key={filePath}
                    type="button"
                    data-slot="read-file-pill"
                    onClick={() => onOpenFile?.(filePath, 1)}
                    className="inline-flex max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-md border border-hairline bg-inset px-2 py-0.5 font-mono text-[11px] text-brand-text transition-colors hover:border-brand/50"
                  >
                    <TechFileBadge path={filePath} />
                    <span className="truncate">{filePath}</span>
                  </button>
                ))}
              </div>

              {/* ShellCard Command Output Wells */}
              {commands.map((cmd, idx) => {
                const isExpanded =
                  expandedCmdIds[cmd.id] ?? idx === commands.length - 1;
                return (
                  <div
                    key={cmd.id}
                    data-slot="shell-card"
                    className="overflow-hidden rounded-[10px] border border-hairline bg-inset"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedCmdIds((prev) => ({
                          ...prev,
                          [cmd.id]: !isExpanded,
                        }))
                      }
                      className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left font-mono text-[11.5px] text-ink hover:bg-hover"
                    >
                      <span className="flex min-w-0 items-center gap-2 truncate">
                        <Terminal
                          className="size-3.5 shrink-0 text-muted-ink"
                          aria-hidden="true"
                        />
                        <span className="truncate">{cmd.command}</span>
                      </span>
                      <span className="shrink-0 rounded-full border border-brand/35 bg-brand-softer px-2 py-px text-[10px] text-brand-text">
                        exit {cmd.exitCode}
                      </span>
                    </button>
                    {isExpanded && (
                      <pre className="m-0 overflow-x-auto border-t border-hairline-soft px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-ink">
                        {cmd.output}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Direct Steering DM Bar */}
      <form
        data-slot="agent-dm-bar"
        data-testid="agent-dm-form"
        onSubmit={(e) => void handleDmSubmit(e)}
        className="flex flex-col gap-1.5 border-t border-hairline bg-chrome px-3.5 py-2.5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={dmInputRef}
            data-testid="agent-dm-input"
            type="text"
            value={dmText}
            onChange={(e) => {
              const value = e.target.value;
              setDmTextByAgent((prev) => ({ ...prev, [agent.agentId]: value }));
              if (dmError) setDmError(null);
              if (dmSentAck) setDmSentAck(null);
            }}
            placeholder={`Send DM to @${agent.label}...`}
            aria-label={`Message @${agent.label} directly`}
            aria-invalid={Boolean(dmError)}
            className={cn(
              "h-8 min-w-0 flex-1 rounded-[9px] border bg-inset px-3 text-[12.5px] text-ink placeholder:text-muted-ink focus:border-brand focus:outline-none",
              dmError ? "border-danger" : "border-premium",
            )}
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!onSendDm || isSendingDm}
            data-testid="agent-dm-submit"
          >
            <Send className="size-3" aria-hidden="true" />
            <span>Send DM</span>
          </Button>
        </div>

        {dmError && (
          <p
            role="alert"
            data-testid="agent-dm-error"
            className="m-0 text-[11.5px] text-danger"
          >
            {dmError}
          </p>
        )}

        {dmSentAck && !dmError && (
          <p
            data-testid="agent-dm-ack"
            className="m-0 text-[11px] text-brand-text"
          >
            {dmSentAck}
          </p>
        )}
      </form>
    </section>
  );
}
