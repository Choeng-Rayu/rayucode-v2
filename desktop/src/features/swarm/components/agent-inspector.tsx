import * as React from "react"
import {
  BookOpen,
  ChevronRight,
  ExternalLink,
  Play,
  Radio,
  Send,
  Square,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ShellCard } from "@/features/execution-trace"
import type { ActionResult } from "@/lib/action-result"
import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import { openWorktreeInVSCode } from "../api/swarm-api"
import { sendDmInputSchema } from "../schemas"
import type { SwarmAgent, SwarmAgentState, SwarmState } from "../types"

export interface AgentInspectorProps {
  agent: SwarmAgent | undefined
  planVersion?: string
  isTogglingAgent?: boolean
  isSendingDm?: boolean
  onToggleAgentState: (agentId: string) => Promise<ActionResult<SwarmState>>
  onSendDm: (
    agentId: string,
    message: string
  ) => Promise<ActionResult<SwarmState>>
  className?: string
}

function getHeaderDotClass(state: SwarmAgentState): string {
  switch (state) {
    case "running":
      return "bg-brand shadow-[0_0_0_3px_var(--accent-soft)]"
    case "coordinating":
    case "completed":
      return "bg-brand/70"
    case "paused":
      return "bg-warn"
    case "stopped":
      return "bg-danger"
  }
}

function parseReadFilePath(raw: string): string {
  const colonIdx = raw.indexOf(":")
  return colonIdx > 0 ? raw.slice(0, colonIdx) : raw
}

export function AgentInspector({
  agent,
  planVersion = "plan v3",
  isTogglingAgent = false,
  isSendingDm = false,
  onToggleAgentState,
  onSendDm,
  className,
}: AgentInspectorProps) {
  const [collapsedByAgent, setCollapsedByAgent] = React.useState<
    Record<string, boolean>
  >({})
  const [dmTextByAgent, setDmTextByAgent] = React.useState<
    Record<string, string>
  >({})
  const [dmErrorState, setDmErrorState] = React.useState<{
    agentId: string
    message: string
  } | null>(null)
  const dmInputRef = React.useRef<HTMLInputElement | null>(null)

  if (!agent) {
    return (
      <section
        data-slot="agent-inspector"
        aria-label="Selected agent trace"
        className={cn(
          "rayu-card-bevel flex min-h-[280px] items-center justify-center rounded-[14px] bg-pane p-6 text-xs text-muted-ink",
          className
        )}
      >
        Select an agent from the roster to inspect its todo lane and live work
        trace.
      </section>
    )
  }

  const traceExpanded = !collapsedByAgent[agent.id]
  const dmText = dmTextByAgent[agent.id] ?? ""
  const dmError =
    dmErrorState && dmErrorState.agentId === agent.id
      ? dmErrorState.message
      : null

  const isCoordinator = agent.id === "coordinator"
  const isStoppedOrPaused =
    agent.state === "stopped" || agent.state === "paused"
  const doneTodos = agent.todoLane.filter(
    (item) => item.status === "done"
  ).length
  const totalTodos = agent.todoLane.length
  const readFiles = agent.readFiles ?? []
  const hasTraceEntries = readFiles.length > 0 || agent.commands.length > 0

  const handleOpenReadFile = (entry: string) => {
    const filePath = parseReadFilePath(entry)
    useAppStore.getState().openCodeFile(filePath, 1)
    toast(`Opened ${filePath}`)
  }

  const handleOpenVSCode = async () => {
    const result = await openWorktreeInVSCode(agent.worktree)
    if (result.ok) {
      toast(`Opened ${agent.worktree} in VS Code`)
    } else {
      toast.error(result.error)
    }
  }

  const handleSendDmSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()
    const parsed = sendDmInputSchema.safeParse({
      agentId: agent.id,
      message: dmText,
    })
    if (!parsed.success) {
      setDmErrorState({
        agentId: agent.id,
        message:
          parsed.error.issues[0]?.message ?? "Steering message cannot be empty",
      })
      dmInputRef.current?.focus()
      return
    }
    setDmErrorState(null)
    const result = await onSendDm(parsed.data.agentId, parsed.data.message)
    if (result.ok) {
      setDmTextByAgent((prev) => ({ ...prev, [agent.id]: "" }))
    } else {
      setDmErrorState({ agentId: agent.id, message: result.error })
    }
  }

  return (
    <section
      data-slot="agent-inspector"
      data-agent-id={agent.id}
      aria-label="Selected agent trace"
      className={cn(
        "rayu-card-bevel flex flex-col overflow-hidden rounded-[14px] bg-pane",
        className
      )}
    >
      {/* Inspector Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline bg-chrome px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "size-2 shrink-0 rounded-full",
              getHeaderDotClass(agent.state)
            )}
          />
          <strong className="font-mono text-[13.5px] font-semibold text-ink">
            {agent.name}
          </strong>
          <span className="rounded-full border border-hairline bg-inset px-2 py-px text-[11px] text-muted-ink">
            {agent.role}
          </span>
          <span className="rounded-sm bg-inset px-1.5 py-0.5 font-mono text-[11px] text-body">
            {agent.model}
          </span>
          <span className="truncate font-mono text-[11.5px] text-muted-ink">
            {agent.worktree}
            {agent.reportsTo ? ` · reports → ${agent.reportsTo}` : ""}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {isCoordinator ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                toast(`Broadcasted ${planVersion} to all active workers`)
              }
            >
              <Radio className="size-3.5" aria-hidden="true" />
              <span>Broadcast plan</span>
            </Button>
          ) : (
            <>
              {agent.worktree !== "local checkout" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleOpenVSCode()}
                    >
                      <ExternalLink className="size-3" aria-hidden="true" />
                      <span>VS Code</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Open {agent.worktree} in VS Code
                  </TooltipContent>
                </Tooltip>
              )}

              <Button
                type="button"
                variant={isStoppedOrPaused ? "outline" : "destructive"}
                size="sm"
                disabled={isTogglingAgent}
                onClick={() => void onToggleAgentState(agent.id)}
                data-slot="agent-lifecycle-toggle"
              >
                {isStoppedOrPaused ? (
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
            </>
          )}
        </div>
      </div>

      {/* Inspector Body */}
      <div className="flex flex-col gap-3.5 px-4 py-3.5">
        {/* Assigned Todo Lane */}
        <div
          data-slot="agent-todo-lane"
          className="flex flex-col gap-1.5 rounded-[10px] border border-hairline bg-inset px-3 py-2.5"
        >
          <div className="mb-0.5 flex items-center justify-between text-[11.5px] font-medium text-muted-ink">
            <span>
              {isCoordinator ? "Coordinator state" : "Assigned todo lane"}
            </span>
            <span className="font-mono tabular-nums">
              {isCoordinator
                ? `${planVersion} approved`
                : `${doneTodos} / ${totalTodos}`}
            </span>
          </div>

          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {agent.todoLane.map((item) => (
              <li
                key={item.id}
                data-status={item.status}
                className={cn(
                  "flex items-center gap-2 text-[12.5px] leading-snug",
                  item.status === "done" && "text-muted-ink line-through",
                  item.status === "now" && "font-medium text-ink",
                  item.status === "pending" && "text-body"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    item.status === "done" && "bg-brand",
                    item.status === "now" &&
                      "bg-brand-bright shadow-[0_0_0_3px_var(--accent-soft)]",
                    item.status === "pending" && "bg-hairline-strong"
                  )}
                />
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Live Codex-Style Work Trace */}
        {agent.note && (
          <p
            data-slot="agent-progress-note"
            className="m-0 text-[12.5px] leading-relaxed text-body"
          >
            {agent.note}
          </p>
        )}

        {hasTraceEntries && (
          <div data-slot="agent-work-trace" className="flex flex-col gap-1.5">
            <button
              type="button"
              aria-expanded={traceExpanded}
              onClick={() =>
                setCollapsedByAgent((prev) => ({
                  ...prev,
                  [agent.id]: !prev[agent.id],
                }))
              }
              className="-ml-1.5 inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] font-medium text-muted-ink transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BookOpen className="size-3.5 shrink-0" aria-hidden="true" />
              <span>Read files, ran commands</span>
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 transition-transform duration-150",
                  traceExpanded && "rotate-90"
                )}
                aria-hidden="true"
              />
            </button>

            {traceExpanded && (
              <div className="ml-[7px] flex flex-col gap-2 border-l border-hairline pl-3.5">
                {readFiles.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-ink">
                    <BookOpen
                      className="size-3.5 shrink-0 text-muted-ink"
                      aria-hidden="true"
                    />
                    <span>Read</span>
                    {readFiles.map((fileEntry) => (
                      <button
                        key={fileEntry}
                        type="button"
                        data-slot="read-file-pill"
                        onClick={() => handleOpenReadFile(fileEntry)}
                        className="cursor-pointer rounded-md border border-hairline bg-inset px-2 py-0.5 font-mono text-[11.5px] text-brand-text transition-colors hover:border-brand/50 hover:bg-brand-softer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {fileEntry}
                      </button>
                    ))}
                  </div>
                )}

                {agent.commands.map((commandStep, idx) => (
                  <ShellCard
                    key={commandStep.id}
                    step={commandStep}
                    defaultExpanded={idx === agent.commands.length - 1}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Direct Steering DM Bar */}
      <form
        data-slot="agent-dm-bar"
        onSubmit={(e) => void handleSendDmSubmit(e)}
        className="flex flex-col gap-1.5 border-t border-hairline bg-chrome px-3.5 py-2.5"
      >
        <div className="flex items-center gap-2">
          <input
            ref={dmInputRef}
            type="text"
            value={dmText}
            onChange={(e) => {
              const value = e.target.value
              setDmTextByAgent((prev) => ({ ...prev, [agent.id]: value }))
              if (dmError) setDmErrorState(null)
            }}
            placeholder={`Message @${agent.name} directly...`}
            aria-label={`Message @${agent.name} directly`}
            aria-invalid={Boolean(dmError)}
            className={cn(
              "h-8 flex-1 rounded-[9px] border bg-inset px-3 text-[12.5px] text-ink placeholder:text-muted-ink focus:border-brand focus:outline-none",
              dmError ? "border-danger" : "border-premium"
            )}
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={isSendingDm}
          >
            <Send className="size-3" aria-hidden="true" />
            <span>Send DM</span>
          </Button>
        </div>

        {dmError && (
          <p role="alert" className="m-0 text-[11.5px] text-danger">
            {dmError}
          </p>
        )}
      </form>
    </section>
  )
}
