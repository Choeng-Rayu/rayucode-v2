import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CheckCircle2,
  Circle,
  Clock,
  Layers,
  ListTodo,
  Wrench,
} from "lucide-react";

import { Badge, Button, ScrollArea } from "@/components/ui";
import { callRpc, cn, useAppStore } from "@/lib";
import type { TodoItemView } from "@shared/vscodeProtocol";

export interface ActiveToolTelemetryItem {
  id: string;
  toolName: string;
  intent: string;
  status: "running" | "completed" | "failed";
  durationLabel?: string;
}

export interface ToolsProgressPanelProps {
  sessionId?: string;
  todosOverride?: TodoItemView[];
  activeTools?: ActiveToolTelemetryItem[];
  className?: string;
}

export function ToolsProgressPanel({
  sessionId: sessionIdProp,
  todosOverride,
  activeTools = [],
  className,
}: ToolsProgressPanelProps) {
  const storeSessionId = useAppStore((s) => s.activeSessionId);
  const sessionId = sessionIdProp ?? storeSessionId ?? "ses_vscode_shell";
  const backgroundTasks = useAppStore((s) => s.backgroundTasks);
  const setBackgroundDrawerOpen = useAppStore((s) => s.setBackgroundDrawerOpen);

  const todosQuery = useQuery({
    queryKey: ["inspector", "todos", sessionId],
    queryFn: () => callRpc("inspector.todos.get", { sessionId }),
    enabled: !todosOverride,
    staleTime: 10_000,
  });

  const todos = todosOverride ?? todosQuery.data?.todos ?? [];
  const completedCount = todos.filter((t) => t.status === "completed").length;
  const inProgressTodos = todos.filter((t) => t.status === "in_progress");
  const pendingTodos = todos.filter((t) => t.status === "pending");
  const completedTodos = todos.filter((t) => t.status === "completed");
  const progressPct =
    todos.length > 0 ? Math.round((completedCount / todos.length) * 100) : 0;

  return (
    <ScrollArea
      data-slot="tools-progress-panel"
      data-testid="tools-progress-panel"
      className={cn("min-h-0 flex-1 bg-canvas", className)}
    >
      <div className="flex flex-col divide-y divide-hairline-soft">
        {/* 1. Live Todo Lanes & Dependencies */}
        <section aria-label="Todo Lanes" className="px-[18px] py-4">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ListTodo
                className="size-4 text-brand-text"
                aria-hidden="true"
              />
              <h2 className="m-0 text-[12.5px] font-medium text-ink">
                Session Todo Plan
              </h2>
            </div>
            <span className="font-mono text-xs text-muted-ink tabular-nums">
              {completedCount}/{todos.length} ({progressPct}%)
            </span>
          </div>

          <div className="mb-3.5 h-1.5 w-full overflow-hidden rounded-full bg-active">
            <div
              className="rayu-effort-bar h-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {todos.length === 0 ? (
            <div className="rounded-lg border border-hairline-soft bg-pane p-3 text-xs text-muted-ink">
              No active todo items tracked in this session yet.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {inProgressTodos.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold tracking-wider text-warn uppercase">
                    In Progress ({inProgressTodos.length})
                  </span>
                  {inProgressTodos.map((todo, idx) => (
                    <div
                      key={`ip_${idx}`}
                      className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft/30 px-2.5 py-2 text-xs text-ink"
                    >
                      <Clock className="mt-0.5 size-3.5 shrink-0 text-warn" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{todo.content}</div>
                        {todo.activeForm && (
                          <div className="mt-0.5 text-[11px] text-muted-ink">
                            {todo.activeForm}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {pendingTodos.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold tracking-wider text-muted-ink uppercase">
                    Pending ({pendingTodos.length})
                  </span>
                  {pendingTodos.map((todo, idx) => (
                    <div
                      key={`pend_${idx}`}
                      className="flex items-start gap-2 rounded-lg border border-hairline-soft bg-pane px-2.5 py-2 text-xs text-body"
                    >
                      <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-ink" />
                      <span className="leading-snug">{todo.content}</span>
                    </div>
                  ))}
                </div>
              )}

              {completedTodos.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold tracking-wider text-brand-text uppercase">
                    Completed ({completedTodos.length})
                  </span>
                  {completedTodos.map((todo, idx) => (
                    <div
                      key={`comp_${idx}`}
                      className="flex items-start gap-2 rounded-lg border border-hairline-soft bg-pane/60 px-2.5 py-2 text-xs text-muted-ink"
                    >
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-brand-text" />
                      <span className="leading-snug line-through">
                        {todo.content}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* 2. Active Tool Telemetry */}
        <section aria-label="Tool Telemetry" className="px-[18px] py-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-info" aria-hidden="true" />
              <h2 className="m-0 text-[12.5px] font-medium text-ink">
                Active Tool Telemetry
              </h2>
            </div>
            <Badge variant="outline" className="font-mono text-[10px]">
              45 Rust tools ready
            </Badge>
          </div>

          {activeTools.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-hairline-soft bg-pane p-3 text-xs text-muted-ink">
              <Wrench className="size-3.5 shrink-0 text-muted-ink" />
              <span>All foreground tools idle · ready for execution.</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {activeTools.map((tool) => (
                <div
                  key={tool.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-hairline bg-pane px-2.5 py-2 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono font-medium text-ink">
                      {tool.toolName}
                    </div>
                    <div className="truncate text-[11px] text-muted-ink">
                      {tool.intent}
                    </div>
                  </div>
                  <Badge
                    variant={
                      tool.status === "failed"
                        ? "danger"
                        : tool.status === "running"
                          ? "brand"
                          : "outline"
                    }
                  >
                    {tool.durationLabel ?? tool.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 3. Background Tasks Handoff */}
        <section aria-label="Background Tasks" className="px-[18px] py-4">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="size-4 text-muted-ink" aria-hidden="true" />
              <h2 className="m-0 text-[12.5px] font-medium text-ink">
                Background Processes ({backgroundTasks.length})
              </h2>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setBackgroundDrawerOpen(true)}
            >
              Open Drawer
            </Button>
          </div>

          {backgroundTasks.map((task) => (
            <div
              key={task.taskId}
              className="mb-1.5 flex flex-col gap-1 rounded-lg border border-hairline bg-pane p-2.5 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono font-medium text-ink">
                  {task.displayName}
                </span>
                <Badge variant="brand">{task.status}</Badge>
              </div>
              <span className="text-[11px] text-muted-ink">{task.summary}</span>
            </div>
          ))}
        </section>
      </div>
    </ScrollArea>
  );
}
